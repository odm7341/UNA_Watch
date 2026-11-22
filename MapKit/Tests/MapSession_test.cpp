/**
 * @file MapSession_test.cpp
 * @brief The state machine the map face reads: which of "no fix", "no pack",
 *        "verifying", "corrupt", "off coverage" and "live" is true, and what
 *        makes each one change.
 *
 * The brief these apps were built to put it plainly: "no pack" and "pack not
 * yet verified" must not look alike, and neither may look like a crash. This
 * file is where that is pinned.
 *
 * The vector fixtures index tiles away from the test fix so a trusted pack
 * can be distinguished from coverage at the center of the viewport.
 */
#include <gtest/gtest.h>

#include <MapKit/MapSession.hpp>
#include <MapKit/PackTrustReader.hpp>
#include <MapKit/TileCache.hpp>

#include "MapKernelFixture.hpp"
#include "VectorFixture.hpp"

#include <string>

namespace {

using MapKit::MapSession;
using MapKit::MapStatus;
using MapKit::PackTrustReader;
using MapKit::TileCache;
using namespace MapKitTest;

// Inside the default VectorSpec bbox.
constexpr float kLat = 44.60F;
constexpr float kLon = -76.00F;
// Well outside it.
constexpr float kFarLat = 51.50F;
constexpr float kFarLon = -0.12F;

std::string inMaps(const std::string& name)
{
    return std::string(MapKit::kMapsDir) + "/" + name;
}

struct SessionFixture : public ::testing::Test {
    MapKitTest::KernelFixture fx;
    TileCache cache;

    void seedPack(const std::string& name, const VectorSpec& spec = VectorSpec{})
    {
        fx.fileSystem.seedFile(inMaps(name), vectorFixture(spec));
    }

    void seedMarker(const std::string& name, uint32_t magic, const VectorSpec& spec = VectorSpec{})
    {
        const std::string pack = vectorFixture(spec);
        fx.fileSystem.seedFile(inMaps(name) + ".trust",
                               buildMarker(magic, pack.size(), declaredCrcOf(pack)));
    }
};

TEST_F(SessionFixture, BeforeAnyFixTheQuestionHasNoAnswer)
{
    // Which pack covers you is unanswerable without a position, so the status
    // says so rather than guessing or blaming the map.
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    EXPECT_EQ(s.status(), MapStatus::NoFix);

    s.onPosition(0.0F, 0.0F, /*fix=*/false, /*recording=*/false);
    EXPECT_EQ(s.status(), MapStatus::NoFix) << "a sample without a fix is not a fix";
    EXPECT_FALSE(s.renderable());
}

TEST_F(SessionFixture, NoPackCoveringThePositionIsSaidPlainly)
{
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kFarLat, kFarLon, true, false);
    EXPECT_EQ(s.status(), MapStatus::NoPack);
    EXPECT_FALSE(s.renderable());
    EXPECT_EQ(s.packName(), nullptr);
}

TEST_F(SessionFixture, NoPacksDeployedAtAllIsAlsoJustNoPack)
{
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_EQ(s.status(), MapStatus::NoPack);
}

TEST_F(SessionFixture, APackWithNoVerdictYetReportsVerifyingAndWithholdsTiles)
{
    // The single most important state to get right: expected, temporary, and
    // resolves on its own. Not an error, and definitely not a blank screen
    // with no explanation.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    EXPECT_EQ(s.status(), MapStatus::Verifying);
    EXPECT_FALSE(s.renderable()) << "tiles must be withheld until the CRC verdict lands";
    EXPECT_STREQ(s.packName(), "city.vtiles");
    EXPECT_EQ(s.packErrorText(), nullptr) << "verifying is not an error";
}

TEST_F(SessionFixture, VerifyingBecomesTrustedWithoutAnythingElseHappening)
{
    // Map Manager finishes its background pass while the app is running. The
    // next GPS sample has to notice, or "verifying" would be a dead end.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Verifying);

    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    s.onPosition(kLat, kLon, true, false);

    EXPECT_TRUE(s.renderable());
    // Off-center fixture, so the honest answer at the crosshair is off-coverage.
    EXPECT_EQ(s.status(), MapStatus::OffCoverage);
}

TEST_F(SessionFixture, APackAlreadyKnownCorruptIsNeverSelected)
{
    // Known-corrupt is screened out at selection, so with only one pack
    // deployed there is nothing left to choose. That is the right answer:
    // "no map for here" is true, and it is more useful than naming a pack the
    // app is never going to draw.
    seedPack("broken.vtiles");
    seedMarker("broken.vtiles", PackTrustReader::kMagicBad);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    EXPECT_EQ(s.status(), MapStatus::NoPack);
    EXPECT_FALSE(s.renderable());
}

TEST_F(SessionFixture, APackThatTurnsCorruptWhileWaitingIsReportedAsCorrupt)
{
    // The path that actually reaches MapStatus::Corrupt: the pack was picked
    // while its verdict was still Absent, and Map Manager's background pass
    // then failed it. A corrupt pack opens *fine* structurally -- the CRC is
    // the only thing wrong with it -- so describing its OpenResult would print
    // "ok" for a broken map. Corrupt is its own state for exactly that reason.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Verifying);

    seedMarker("city.vtiles", PackTrustReader::kMagicBad);
    s.onPosition(kLat, kLon, true, false);

    EXPECT_EQ(s.status(), MapStatus::Corrupt);
    EXPECT_FALSE(s.renderable());
    EXPECT_EQ(s.packErrorText(), nullptr)
        << "the open result is 'ok'; the corruption is reported as its own state";
}

TEST_F(SessionFixture, ACorruptVerdictIsFinalAndStopsThePolling)
{
    // Sticky both ways: a file confirmed corrupt does not become whole by
    // being read again, so the session must not flip back to Verifying.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    seedMarker("city.vtiles", PackTrustReader::kMagicBad);
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Corrupt);

    fx.fileSystem.files.erase(inMaps("city.vtiles") + ".trust");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_EQ(s.status(), MapStatus::Corrupt);
}

TEST_F(SessionFixture, ACorruptPackDoesNotBlockAWorkingOne)
{
    seedPack("broken.vtiles");
    seedMarker("broken.vtiles", PackTrustReader::kMagicBad);
    seedPack("fine.vtiles");
    seedMarker("fine.vtiles", PackTrustReader::kMagicGood);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_STREQ(s.packName(), "fine.vtiles");
    EXPECT_TRUE(s.renderable());
}

TEST_F(SessionFixture, TheDeeperPackIsChosenWhenSeveralCover)
{
    VectorSpec shallow; shallow.zoomMax = 13;
    VectorSpec deep;    deep.zoomMax    = 14;
    seedPack("region.vtiles", shallow);
    seedPack("city.vtiles", deep);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_STREQ(s.packName(), "city.vtiles");
}

TEST_F(SessionFixture, ZoomStartsAtThePacksFinestLevel)
{
    VectorSpec spec; spec.zoomMin = 12; spec.zoomMax = 14;
    seedPack("city.vtiles", spec);
    seedMarker("city.vtiles", PackTrustReader::kMagicGood, spec);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_EQ(s.zoom(), 14) << "the wearer is looking at where they are";
}

TEST_F(SessionFixture, ZoomCyclesThroughThePacksOwnRangeAndWraps)
{
    VectorSpec spec; spec.zoomMin = 12; spec.zoomMax = 14;
    seedPack("city.vtiles", spec);
    seedMarker("city.vtiles", PackTrustReader::kMagicGood, spec);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.zoom(), 14);
    s.cycleZoom();  EXPECT_EQ(s.zoom(), 12) << "wraps to the pack's coarsest";
    s.cycleZoom();  EXPECT_EQ(s.zoom(), 13);
    s.cycleZoom();  EXPECT_EQ(s.zoom(), 14);
}

TEST_F(SessionFixture, ZoomReportsThatItDidNothingWhenThereIsNoPack)
{
    // The return value is what lets the caller hand R2 back to the lap it
    // means on every other face. A watch with no packs installed must not end
    // up with a dead button on this one.
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kFarLat, kFarLon, true, false);
    const uint8_t before = s.zoom();
    EXPECT_FALSE(s.cycleZoom());
    EXPECT_EQ(s.zoom(), before);
}

TEST_F(SessionFixture, ZoomReportsThatItDidNothingWhileStillVerifying)
{
    // Same reasoning during the seconds after a fresh pack is deployed: the
    // face is not drawing tiles yet, so there is nothing to zoom, so the
    // button should still take a lap.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Verifying);
    EXPECT_FALSE(s.cycleZoom());
}

TEST_F(SessionFixture, ZoomReportsSuccessOnceThereIsAMapToZoom)
{
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_TRUE(s.renderable());
    EXPECT_TRUE(s.cycleZoom());
}

TEST_F(SessionFixture, AGapInCoverageIsRecordedForWhoeverBuildsPacks)
{
    // The watch is the only thing that knows the wearer went somewhere with no
    // map. See TileRequestLog.
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    ASSERT_EQ(s.status(), MapStatus::NoPack);
    EXPECT_EQ(s.requests().count(), 1u);
    const std::string filed = fx.fileSystem.readFile("../SharedData/maps/requested-tiles.txt");
    EXPECT_NE(filed.find("TestApp"), std::string::npos);
}

TEST_F(SessionFixture, ALiveMapRecordsNoRequest)
{
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    // The fixture packs carry no tiles, so this is honestly off-coverage --
    // which is a gap, and is recorded. What matters is that it is the tile
    // test deciding, not the mere presence of a pack.
    ASSERT_EQ(s.status(), MapStatus::OffCoverage);
    EXPECT_EQ(s.requests().count(), 1u);
}

TEST_F(SessionFixture, ABrokenPackIsNotFiledAsAMissingOne)
{
    // A pack that will not open, and one confirmed corrupt, both leave the
    // screen blank -- but the answer to each is to re-copy a pack that already
    // exists, not to build a new one. Filing them here would put work in the
    // queue that nobody should do.
    std::string pack = vectorFixture();
    pack[225] = static_cast<char>(0xFF);          // reserved index byte must be zero
    fx.fileSystem.seedFile(inMaps("mangled.vtiles"), pack);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::PackError);
    EXPECT_EQ(s.requests().count(), 0u);
}

TEST_F(SessionFixture, APackStillVerifyingIsNotFiledAsAMissingOne)
{
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Verifying);
    EXPECT_EQ(s.requests().count(), 0u)
        << "the map is probably fine; it just has not been checked yet";
}

TEST_F(SessionFixture, StandingStillOutsideCoverageFilesOneRequestNotOnePerSample)
{
    MapSession s(fx.kernel, cache, "TestApp");
    for (int i = 0; i < 200; ++i) {
        s.onPosition(kLat, kLon, true, true);
    }
    EXPECT_EQ(s.requests().count(), 1u);
}

TEST_F(SessionFixture, WithNoSharedMapDirectoryAtAllTheActivityIsUnaffected)
{
    // The shape of a watch that has never had MapManager or a pack on it: the
    // directory does not exist, so there is nothing to open, list or verify.
    // That is a normal state, not an error, and everything the activity itself
    // depends on has to keep working through it.
    MapSession s(fx.kernel, cache, "TestApp");

    for (int i = 0; i < 10; ++i) {
        s.onPosition(kLat + 0.001F * i, kLon, true, /*recording=*/true);
    }

    EXPECT_EQ(s.status(), MapStatus::NoPack);
    EXPECT_FALSE(s.renderable());
    EXPECT_EQ(s.packName(), nullptr);
    EXPECT_EQ(s.packErrorText(), nullptr) << "no pack is not a pack error";
    EXPECT_FALSE(s.cycleZoom()) << "so R2 stays the lap button";
    // The breadcrumb -- the thing the activity actually records -- is
    // unaffected by there being no basemap under it.
    EXPECT_GT(s.trace().count(), 1u);
}

TEST_F(SessionFixture, TheTraceGrowsOnlyWhileRecording)
{
    // A paused activity must not draw a straight line across the gap where
    // the wearer stood still, or across a drive home.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");

    s.onPosition(kLat, kLon, true, /*recording=*/false);
    EXPECT_EQ(s.trace().count(), 0u);

    s.onPosition(kLat, kLon, true, /*recording=*/true);
    EXPECT_EQ(s.trace().count(), 1u);

    s.onPosition(kLat + 0.01F, kLon + 0.01F, true, /*recording=*/false);
    EXPECT_EQ(s.trace().count(), 1u);
}

TEST_F(SessionFixture, TheTraceIgnoresSamplesWithNoFix)
{
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, true);
    s.onPosition(0.0F, 0.0F, /*fix=*/false, true);
    EXPECT_EQ(s.trace().count(), 1u) << "a no-fix sample must not append (0, 0)";
}

TEST_F(SessionFixture, ResetTraceClearsTheBreadcrumbButKeepsThePack)
{
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, true);
    ASSERT_EQ(s.trace().count(), 1u);
    ASSERT_TRUE(s.renderable());

    s.resetTrace();
    EXPECT_EQ(s.trace().count(), 0u);
    EXPECT_TRUE(s.renderable()) << "a new activity does not re-verify the map";
}

TEST_F(SessionFixture, WalkingOffOnePackOntoAnotherReselects)
{
    VectorSpec here;  // default bbox, eastern Ontario
    VectorSpec there;
    there.minLon = -1000000; there.minLat =  51000000;
    there.maxLon =  1000000; there.maxLat =  52000000;   // around London

    seedPack("ontario.vtiles", here);
    seedPack("london.vtiles", there);
    seedMarker("ontario.vtiles", PackTrustReader::kMagicGood, here);
    seedMarker("london.vtiles", PackTrustReader::kMagicGood, there);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_STREQ(s.packName(), "ontario.vtiles");

    s.onPosition(kFarLat, kFarLon, true, false);
    EXPECT_STREQ(s.packName(), "london.vtiles");
    EXPECT_TRUE(s.renderable());
}

TEST_F(SessionFixture, TheDirectoryIsScannedExactlyOncePerLaunch)
{
    // Regression, found by running the simulator with the maps directory
    // emptied. The scan itself now runs in the constructor rather than on the
    // first fix (attribution has to be showable before a fix arrives), but the
    // rule this pins is unchanged: nothing keyed on "no pack selected" may
    // rescan, because that condition persists for as long as the wearer stays
    // outside coverage --
    // rescanning there would mean a directory walk plus a header, footer and
    // marker read per pack, once a second, for a whole activity, on the GUI
    // thread, to re-learn what it already knew.
    //
    // Asserted by its visible consequence: a pack that appears *after* the
    // scan is not picked up. That is the accepted cost, and it costs nothing
    // real -- a pack can only arrive over USB, and connecting USB terminates
    // every running app, so no pack has ever appeared under a running one.
    // Valid, and covering neither of this file's two reference positions, so
    // the scan finds something without that something ever being selectable.
    VectorSpec elsewhere;
    elsewhere.minLon = 130000000; elsewhere.minLat = -40000000;
    elsewhere.maxLon = 140000000; elsewhere.maxLat = -30000000;
    seedPack("elsewhere.vtiles", elsewhere);
    MapSession s(fx.kernel, cache, "TestApp");

    s.onPosition(kFarLat, kFarLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::NoPack);

    seedPack("city.vtiles");          // would cover kLat/kLon, but arrives late
    for (int i = 0; i < 30; ++i) {
        s.onPosition(kLat, kLon, true, false);
    }
    EXPECT_EQ(s.status(), MapStatus::NoPack)
        << "a rescan on every sample would have found the late pack";
    EXPECT_EQ(s.packName(), nullptr);
}

/// The reason the scan moved off the first fix. ODbL section 4.3's notice is
/// owed for the data on the watch, not for whichever pack a fix happens to
/// choose, and the app has to be able to show it at startup -- indoors, with
/// no lock, before a single GPS sample has arrived.
TEST_F(SessionFixture, AttributionIsAvailableBeforeAnyGpsSample)
{
    VectorSpec spec;
    spec.attribution = "Map data from OpenStreetMap (ODbL)";
    seedPack("city.vtiles", spec);

    MapSession s(fx.kernel, cache, "TestApp");

    ASSERT_EQ(s.status(), MapStatus::NoFix) << "precondition: no fix has arrived";
    ASSERT_EQ(s.attributionCount(), 1u);
    EXPECT_STREQ(s.attributionAt(0), "Map data from OpenStreetMap (ODbL)");
    EXPECT_EQ(s.unattributedPacks(), 0u);
}

/// A pack that covers nowhere near the wearer is still installed, and its
/// data is still credited. Attribution follows what is on the watch, not what
/// is drawable from here.
TEST_F(SessionFixture, CreditsPacksThatCoverNowhereNearTheWearer)
{
    VectorSpec elsewhere;
    elsewhere.minLon = 130000000; elsewhere.minLat = -40000000;
    elsewhere.maxLon = 140000000; elsewhere.maxLat = -30000000;
    elsewhere.attribution = "Map data from OpenStreetMap (ODbL)";
    seedPack("elsewhere.vtiles", elsewhere);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    ASSERT_EQ(s.status(), MapStatus::NoPack) << "precondition: nothing covers here";
    EXPECT_EQ(s.attributionCount(), 1u) << "still installed, still credited";
}

TEST_F(SessionFixture, WalkingIntoCoverageStillFindsThePack)
{
    // The other half of scanning once: re-selection has to keep running, or a
    // wearer who started outside every pack would never get a map.
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");

    s.onPosition(kFarLat, kFarLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::NoPack);

    s.onPosition(kLat, kLon, true, false);
    EXPECT_STREQ(s.packName(), "city.vtiles");
    EXPECT_TRUE(s.renderable());
}

TEST_F(SessionFixture, APackThatTurnsCorruptFallsBackToAnotherThatCovers)
{
    // A verdict landing mid-activity should not cost the wearer a map they
    // could otherwise have had.
    VectorSpec deep;    deep.zoomMax = 14;
    VectorSpec shallow; shallow.zoomMax = 13;
    seedPack("detailed.vtiles", deep);
    seedPack("coarse.vtiles", shallow);
    seedMarker("coarse.vtiles", PackTrustReader::kMagicGood, shallow);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_STREQ(s.packName(), "detailed.vtiles");
    ASSERT_EQ(s.status(), MapStatus::Verifying);

    seedMarker("detailed.vtiles", PackTrustReader::kMagicBad, deep);
    s.onPosition(kLat, kLon, true, false);

    EXPECT_STREQ(s.packName(), "coarse.vtiles");
    EXPECT_TRUE(s.renderable());
}

TEST_F(SessionFixture, WithNothingToFallBackToACorruptPackKeepsItsOwnDiagnosis)
{
    // "map pack corrupt" tells whoever has to fix it more than "no map for
    // here", so with no alternative the session stays put rather than
    // reselecting into nothing.
    seedPack("city.vtiles");
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_EQ(s.status(), MapStatus::Verifying);

    seedMarker("city.vtiles", PackTrustReader::kMagicBad);
    s.onPosition(kLat, kLon, true, false);

    EXPECT_EQ(s.status(), MapStatus::Corrupt);
    EXPECT_STREQ(s.packName(), "city.vtiles");
}

TEST_F(SessionFixture, StayingInsideThePackDoesNotReopenIt)
{
    // Re-selection walks the directory and re-peeks every header. Doing that
    // on every GPS sample would put it on the GUI thread once a second.
    seedPack("city.vtiles");
    seedMarker("city.vtiles", PackTrustReader::kMagicGood);
    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    ASSERT_TRUE(s.renderable());

    // Remove the pack from under the session. If it re-opened, this would fail.
    fx.fileSystem.files.erase(inMaps("city.vtiles"));
    s.onPosition(kLat + 0.001F, kLon + 0.001F, true, false);
    EXPECT_TRUE(s.renderable());
    EXPECT_STREQ(s.packName(), "city.vtiles");
}

TEST_F(SessionFixture, AStructurallyBrokenPackIsAnErrorWithAReason)
{
    // Passes the catalog's cheap header screen (magic, format, tile dim, bbox
    // are all fine) but fails the structural open, which checks the tile index
    // the peek never looks at.
    std::string pack = vectorFixture();
    pack[225] = static_cast<char>(0xFF);   // reserved index byte must be zero
    fx.fileSystem.seedFile(inMaps("mangled.vtiles"), pack);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);

    EXPECT_EQ(s.status(), MapStatus::PackError);
    EXPECT_FALSE(s.renderable());
    ASSERT_NE(s.packErrorText(), nullptr);
    EXPECT_STRNE(s.packErrorText(), "ok") << "an error must not describe itself as ok";
    EXPECT_STREQ(s.packName(), "mangled.vtiles") << "say which pack failed";
}

TEST_F(SessionFixture, OpensPacksWithoutRunningTheWholeFileCrcScan)
{
    // The load-bearing performance property, stated as behaviour: a pack whose
    // body no longer matches its declared CRC still opens structurally. If the
    // GUI-thread open ever went back to verifying, this would fail -- and on
    // hardware a 201 MB pack would trip the app-liveness watchdog and restart
    // the watch.
    std::string pack = vectorFixture();
    pack.back() = static_cast<char>(pack.back() ^ 0xFF);   // break the footer
    fx.fileSystem.seedFile(inMaps("city.vtiles"), pack);

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_EQ(s.status(), MapStatus::Verifying)
        << "structural open must succeed; trust is Map Manager's to grant";
}

TEST_F(SessionFixture, AMarkerForDifferentBytesLeavesTheSessionWaiting)
{
    // The (size, crc) guard, seen from the outside: a stale Good marker must
    // not make a replaced pack renderable.
    seedPack("city.vtiles");
    const std::string pack = vectorFixture();
    fx.fileSystem.seedFile(inMaps("city.vtiles") + ".trust",
                           buildMarker(PackTrustReader::kMagicGood,
                                       pack.size() + 1, declaredCrcOf(pack)));

    MapSession s(fx.kernel, cache, "TestApp");
    s.onPosition(kLat, kLon, true, false);
    EXPECT_EQ(s.status(), MapStatus::Verifying);
    EXPECT_FALSE(s.renderable());
}

} // namespace
