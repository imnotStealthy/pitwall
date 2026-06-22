// src/parser.js — FH6 324-byte packet parser, little-endian

export function parsePacket(buf) {
  if (buf.length < 324) return null;

  const f32 = (o) => buf.readFloatLE(o);
  const s32 = (o) => buf.readInt32LE(o);
  const u32 = (o) => buf.readUInt32LE(o);

  return {
    IsRaceOn: s32(0),
    TimestampMS: u32(4),
    EngineMaxRpm: f32(8),
    EngineIdleRpm: f32(12),
    CurrentEngineRpm: f32(16),
    AccelerationX: f32(20),
    AccelerationY: f32(24),
    AccelerationZ: f32(28),
    VelocityX: f32(32),
    VelocityY: f32(36),
    VelocityZ: f32(40),
    AngularVelocityX: f32(44),
    AngularVelocityY: f32(48),
    AngularVelocityZ: f32(52),
    Yaw: f32(56),
    Pitch: f32(60),
    Roll: f32(64),
    NormalizedSuspensionTravelFrontLeft: f32(68),
    NormalizedSuspensionTravelFrontRight: f32(72),
    NormalizedSuspensionTravelRearLeft: f32(76),
    NormalizedSuspensionTravelRearRight: f32(80),
    TireSlipRatioFrontLeft: f32(84),
    TireSlipRatioFrontRight: f32(88),
    TireSlipRatioRearLeft: f32(92),
    TireSlipRatioRearRight: f32(96),
    WheelRotationSpeedFrontLeft: f32(100),
    WheelRotationSpeedFrontRight: f32(104),
    WheelRotationSpeedRearLeft: f32(108),
    WheelRotationSpeedRearRight: f32(112),
    WheelOnRumbleStripFrontLeft: s32(116),
    WheelOnRumbleStripFrontRight: s32(120),
    WheelOnRumbleStripRearLeft: s32(124),
    WheelOnRumbleStripRearRight: s32(128),
    WheelInPuddleFrontLeft: s32(132),
    WheelInPuddleFrontRight: s32(136),
    WheelInPuddleRearLeft: s32(140),
    WheelInPuddleRearRight: s32(144),
    SurfaceRumbleFrontLeft: f32(148),
    SurfaceRumbleFrontRight: f32(152),
    SurfaceRumbleRearLeft: f32(156),
    SurfaceRumbleRearRight: f32(160),
    TireSlipAngleFrontLeft: f32(164),
    TireSlipAngleFrontRight: f32(168),
    TireSlipAngleRearLeft: f32(172),
    TireSlipAngleRearRight: f32(176),
    TireCombinedSlipFrontLeft: f32(180),
    TireCombinedSlipFrontRight: f32(184),
    TireCombinedSlipRearLeft: f32(188),
    TireCombinedSlipRearRight: f32(192),
    SuspensionTravelMetersFrontLeft: f32(196),
    SuspensionTravelMetersFrontRight: f32(200),
    SuspensionTravelMetersRearLeft: f32(204),
    SuspensionTravelMetersRearRight: f32(208),
    CarOrdinal: s32(212),
    CarClass: s32(216),
    CarPerformanceIndex: s32(220),
    DrivetrainType: s32(224),
    NumCylinders: s32(228),
    CarGroup: u32(232),
    SmashableVelDiff: f32(236),
    SmashableMass: f32(240),
    PositionX: f32(244),
    PositionY: f32(248),
    PositionZ: f32(252),
    Speed: f32(256),
    Power: f32(260),
    Torque: f32(264),
    TireTempFrontLeft: f32(268),
    TireTempFrontRight: f32(272),
    TireTempRearLeft: f32(276),
    TireTempRearRight: f32(280),
    Boost: f32(284),
    Fuel: f32(288),
    DistanceTraveled: f32(292),
    BestLap: f32(296),
    LastLap: f32(300),
    CurrentLap: f32(304),
    CurrentRaceTime: f32(308),
    LapNumber: buf.readUInt16LE(312),
    RacePosition: buf.readUInt8(314),
    Accel: buf.readUInt8(315),
    Brake: buf.readUInt8(316),
    Clutch: buf.readUInt8(317),
    HandBrake: buf.readUInt8(318),
    Gear: buf.readUInt8(319),
    Steer: buf.readInt8(320),
    NormalizedDrivingLine: buf.readInt8(321),
    NormalizedAIBrakeDifference: buf.readInt8(322),
  };
}

// --- Inline self-test: run with `node src/parser.js` ---
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('parser.js')) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };

  // too-short buffer rejected
  assert(parsePacket(Buffer.alloc(100)) === null, 'rejects buffer < 324 bytes');

  const buf = Buffer.alloc(324);
  buf.writeInt32LE(1, 0);              // IsRaceOn
  buf.writeFloatLE(8500, 8);           // EngineMaxRpm
  buf.writeFloatLE(6240, 16);          // CurrentEngineRpm
  buf.writeInt32LE(5, 216);            // CarClass
  buf.writeFloatLE(39.5, 256);         // Speed (m/s)
  buf.writeFloatLE(222222, 260);       // Power (watts)
  buf.writeFloatLE(82.1, 268);         // TireTempFL
  buf.writeUInt16LE(2, 312);           // LapNumber
  buf.writeUInt8(1, 314);              // RacePosition
  buf.writeUInt8(220, 315);            // Accel
  buf.writeUInt8(4, 319);              // Gear
  buf.writeInt8(-12, 320);             // Steer

  const p = parsePacket(buf);
  assert(p.IsRaceOn === 1, 'IsRaceOn @0');
  assert(p.EngineMaxRpm === 8500, 'EngineMaxRpm @8');
  assert(p.CurrentEngineRpm === 6240, 'CurrentEngineRpm @16');
  assert(p.CarClass === 5, 'CarClass @216');
  assert(Math.abs(p.Speed - 39.5) < 1e-3, 'Speed @256');
  assert(p.LapNumber === 2, 'LapNumber @312 (U16)');
  assert(p.RacePosition === 1, 'RacePosition @314 (U8)');
  assert(p.Accel === 220, 'Accel @315 (U8)');
  assert(p.Gear === 4, 'Gear @319 (U8)');
  assert(p.Steer === -12, 'Steer @320 (S8)');

  console.log('\nAll parser offset tests passed.');
}
