#include <gtest/gtest.h>

#include <MapKit/MapBrowserSession.hpp>
#include <MapKit/MapSession.hpp>
#include <MapKit/TileCache.hpp>

#include "KernelTestDoubles.hpp"

namespace {

struct BrowserFixture : public ::testing::Test {
    SDK::TestSupport::KernelFixture fx;
    MapKit::TileCache cache;
    MapKit::MapSession session { fx.kernel, cache, "BrowserTest" };
    MapKit::MapBrowserSession browser { session };
};

TEST_F(BrowserFixture, FirstLocationRecentresTheInitialFollowViewport)
{
    EXPECT_TRUE(browser.following());
    EXPECT_TRUE(browser.onLocation(123456, 789012));
    EXPECT_EQ(browser.centerX(), 123456);
    EXPECT_EQ(browser.centerY(), 789012);
}

TEST_F(BrowserFixture, ManualPanDisablesFollowUntilExplicitlyRestored)
{
    ASSERT_TRUE(browser.onLocation(1000000, 2000000));
    ASSERT_TRUE(browser.adjust(true));
    EXPECT_FALSE(browser.following());

    const int64_t pannedX = browser.centerX();
    const int64_t pannedY = browser.centerY();
    EXPECT_FALSE(browser.onLocation(3000000, 4000000));
    EXPECT_EQ(browser.centerX(), pannedX);
    EXPECT_EQ(browser.centerY(), pannedY);

    browser.cycleOperation(4); // North/South -> Follow
    ASSERT_EQ(browser.operation(), MapKit::MapBrowserSession::Operation::Follow);
    ASSERT_TRUE(browser.adjust(true)); // R2: resume following the latest fix
    EXPECT_TRUE(browser.following());
    EXPECT_EQ(browser.centerX(), 3000000);
    EXPECT_EQ(browser.centerY(), 4000000);
}

TEST_F(BrowserFixture, InvalidatedLocationCannotRecentreFollow)
{
    ASSERT_TRUE(browser.onLocation(123456, 789012));
    browser.clearLocation();
    browser.cycleOperation(4);
    ASSERT_TRUE(browser.adjust(false));
    ASSERT_TRUE(browser.adjust(true));
    EXPECT_EQ(browser.centerX(), 123456);
    EXPECT_EQ(browser.centerY(), 789012);
}

} // namespace
