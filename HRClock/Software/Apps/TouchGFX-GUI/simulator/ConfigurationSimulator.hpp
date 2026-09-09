/**
 ******************************************************************************
 * @file    ConfigurationSimulator.hpp
 * @brief   What the simulated sensor layer feeds this app.
 ******************************************************************************
 */

#ifndef CONFIG_SIMULATOR_HPP
#define CONFIG_SIMULATOR_HPP

// GPS driver remains disabled. The speed values only feed the shared simulator
// object that also produces STEP_COUNTER samples.
#define GSP_SIM_ENABLE               0
#define GSP_SIM_SPEED_MIN            4
#define GPS_SIM_SPEED_BASE           5
#define GPS_SIM_SPEED_MAX            6
#define GPS_SIM_TIME_SEACH_SATELLITE 0

// Heart-rate sensor. HRClock duty-cycles the connection; this only makes a
// simulator driver available when the service briefly connects.
#define HEAT_RATE_SIM_ENABLE        1
#define HEAT_RATE_SIM_MIN_HR        90
#define HEAT_RATE_SIM_MAX_HR        140
#define HEAT_RATE_SIM_TYPE_TRAINING 2

// Pressure sensor
#define PRESSURE_SIM_ENABLE       0
#define PRESSURE_SIM_PRESS_VALLUE 0.0f

// Battery level sensor: event driven, current value on connect, changed values after.
#define BATT_LEVEL_SIM_ENABLE      1
#define BATT_LEVEL_SIM_START_VALUE 73
#define BATT_LEVEL_SIM_STEP_VALUE  0.2f

// IMU wrist-detect sensor
#define IMU_WRIST_SIM_ENABLE           0
#define IMU_WRIST_SIM_WRIST_DETECT_KEY '5'

// IMU step counter. HRClock consumes the SDK cumulative step-count sensor;
// it does not read raw accelerometer data.
#define IMU_STEP_COUNTER_SIM_ENABLE        1
#define IMU_STEP_COUNTER_SIM_STRIDE_LENGTH 0.65f

#endif // CONFIG_SIMULATOR_HPP
