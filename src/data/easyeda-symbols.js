/**
 * Part-kind → schematic symbol / PCB footprint map.
 *
 * Maps bw-circuit-ui part kinds to KiCad library references and
 * EasyEDA-compatible designator prefixes. Used by netlist.js and
 * the KiCad/SPICE/EasyEDA exporters.
 *
 * Coverage: common passives, discretes, ICs, sensors, MCU boards.
 * Parts with no meaningful schematic symbol (breadboard, jumper)
 * are deliberately excluded — they dissolve into nets.
 *
 * @module
 */

/**
 * @typedef {object} PartSymbol
 * @property {string} refdesPrefix — reference designator prefix (R, C, U…)
 * @property {string} spiceCard — SPICE element letter (R, C, D, Q, V, X…)
 * @property {string} kicadSymbol — KiCad symbol lib:part
 * @property {string} kicadFootprint — KiCad footprint lib:footprint
 * @property {string} [spiceModel] — SPICE .model name if needed
 */

/** @type {Record<string, PartSymbol>} */
export const PART_SYMBOLS = {
  // ── Passives ──────────────────────────────────────────────────
  resistor: {
    refdesPrefix: 'R', spiceCard: 'R',
    kicadSymbol: 'Device:R',
    kicadFootprint: 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal',
  },
  potentiometer: {
    refdesPrefix: 'RV', spiceCard: 'R',
    kicadSymbol: 'Device:R_Potentiometer',
    kicadFootprint: 'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical',
  },
  ldr: {
    refdesPrefix: 'R', spiceCard: 'R',
    kicadSymbol: 'Device:R_Photo',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
  },
  ntc: {
    refdesPrefix: 'R', spiceCard: 'R',
    kicadSymbol: 'Device:Thermistor_NTC',
    kicadFootprint: 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal',
  },
  capacitor: {
    refdesPrefix: 'C', spiceCard: 'C',
    kicadSymbol: 'Device:C',
    kicadFootprint: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P2.50mm',
  },
  polarized_cap: {
    refdesPrefix: 'C', spiceCard: 'C',
    kicadSymbol: 'Device:C_Polarized',
    kicadFootprint: 'Capacitor_THT:CP_Radial_D5.0mm_P2.50mm',
  },
  inductor: {
    refdesPrefix: 'L', spiceCard: 'L',
    kicadSymbol: 'Device:L',
    kicadFootprint: 'Inductor_THT:L_Axial_L5.3mm_D2.2mm_P10.16mm_Horizontal',
  },

  // ── Diodes / LEDs ─────────────────────────────────────────────
  diode: {
    refdesPrefix: 'D', spiceCard: 'D',
    kicadSymbol: 'Device:D',
    kicadFootprint: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal',
    spiceModel: '1N4148',
  },
  zener: {
    refdesPrefix: 'D', spiceCard: 'D',
    kicadSymbol: 'Device:D_Zener',
    kicadFootprint: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal',
    spiceModel: '1N4733A',
  },
  led: {
    refdesPrefix: 'D', spiceCard: 'D',
    kicadSymbol: 'Device:LED',
    kicadFootprint: 'LED_THT:LED_D3.0mm',
    spiceModel: 'LED',
  },
  rgb_led: {
    refdesPrefix: 'D', spiceCard: 'X',
    kicadSymbol: 'Device:LED_RGBA',
    kicadFootprint: 'LED_THT:LED_D5.0mm-4',
  },

  // ── Transistors ───────────────────────────────────────────────
  npn: {
    refdesPrefix: 'Q', spiceCard: 'Q',
    kicadSymbol: 'Device:Q_NPN_BCE',
    kicadFootprint: 'Package_TO_SOT_THT:TO-92_Inline',
    spiceModel: '2N2222',
  },
  pnp: {
    refdesPrefix: 'Q', spiceCard: 'Q',
    kicadSymbol: 'Device:Q_PNP_BCE',
    kicadFootprint: 'Package_TO_SOT_THT:TO-92_Inline',
    spiceModel: '2N2907',
  },
  nmos: {
    refdesPrefix: 'Q', spiceCard: 'M',
    kicadSymbol: 'Device:Q_NMOS_GDS',
    kicadFootprint: 'Package_TO_SOT_THT:TO-92_Inline',
  },
  pmos: {
    refdesPrefix: 'Q', spiceCard: 'M',
    kicadSymbol: 'Device:Q_PMOS_GDS',
    kicadFootprint: 'Package_TO_SOT_THT:TO-92_Inline',
  },
  tip120: {
    refdesPrefix: 'Q', spiceCard: 'Q',
    kicadSymbol: 'Transistor_BJT:TIP120',
    kicadFootprint: 'Package_TO_SOT_THT:TO-220-3_Vertical',
    spiceModel: 'TIP120',
  },

  // ── Op-amps / Analog ICs ──────────────────────────────────────
  opamp: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Amplifier_Operational:LM741',
    kicadFootprint: 'Package_DIP:DIP-8_W7.62mm',
  },
  '555': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Timer:NE555',
    kicadFootprint: 'Package_DIP:DIP-8_W7.62mm',
  },
  '556': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Timer:NE556',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },

  // ── Switches / Buttons ────────────────────────────────────────
  button: {
    refdesPrefix: 'SW', spiceCard: 'S',
    kicadSymbol: 'Switch:SW_Push',
    kicadFootprint: 'Button_Switch_THT:SW_PUSH_6mm',
  },
  switch: {
    refdesPrefix: 'SW', spiceCard: 'S',
    kicadSymbol: 'Switch:SW_SPST',
    kicadFootprint: 'Button_Switch_THT:SW_Slide_1P2T_CK_OS102011MA1QN1',
  },
  slide_switch: {
    refdesPrefix: 'SW', spiceCard: 'S',
    kicadSymbol: 'Switch:SW_SPDT',
    kicadFootprint: 'Button_Switch_THT:SW_Slide_1P2T_CK_OS102011MA1QN1',
  },

  // ── Relays ────────────────────────────────────────────────────
  relay: {
    refdesPrefix: 'K', spiceCard: 'X',
    kicadSymbol: 'Relay:SANYOU_SRD_Form_C',
    kicadFootprint: 'Relay_THT:Relay_SPDT_SANYOU_SRD_Series_Form_C',
  },

  // ── Power / Sources ───────────────────────────────────────────
  vsource: {
    refdesPrefix: 'V', spiceCard: 'V',
    kicadSymbol: 'power:VCC',
    kicadFootprint: '',
  },
  isource: {
    refdesPrefix: 'I', spiceCard: 'I',
    kicadSymbol: 'Simulation_SPICE:ISOURCE',
    kicadFootprint: '',
  },
  battery_9v: {
    refdesPrefix: 'BT', spiceCard: 'V',
    kicadSymbol: 'Device:Battery',
    kicadFootprint: 'Battery:BatteryHolder_Keystone_1294_1x9V',
  },
  battery_aa: {
    refdesPrefix: 'BT', spiceCard: 'V',
    kicadSymbol: 'Device:Battery',
    kicadFootprint: 'Battery:BatteryHolder_Keystone_2460_1xAA',
  },
  fuse: {
    refdesPrefix: 'F', spiceCard: 'R',
    kicadSymbol: 'Device:Fuse',
    kicadFootprint: 'Fuse:Fuseholder_Cylinder-5x20mm_Schurter_0031.8201_Horizontal_Open',
  },

  // ── Output devices ────────────────────────────────────────────
  buzzer: {
    refdesPrefix: 'LS', spiceCard: 'X',
    kicadSymbol: 'Device:Buzzer',
    kicadFootprint: 'Buzzer_Beeper:Buzzer_12x9.5RM7.6',
  },
  dc_motor: {
    refdesPrefix: 'M', spiceCard: 'X',
    kicadSymbol: 'Motor:Motor_DC',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
  },
  servo: {
    refdesPrefix: 'M', spiceCard: 'X',
    kicadSymbol: 'Motor:Motor_Servo',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
  },
  seven_segment: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Display_Character:7SEG-CA',
    kicadFootprint: 'Display_7Segment:7SegmentLED_LTS6760_LTS6780',
  },

  // ── Logic ICs (DIP) ───────────────────────────────────────────
  '74hc00': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC00',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc02': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC02',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc04': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC04',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc08': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC08',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc32': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC32',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc86': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC86',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  '74hc595': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC595',
    kicadFootprint: 'Package_DIP:DIP-16_W7.62mm',
  },
  '74hc74': {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '74xx:74HC74',
    kicadFootprint: 'Package_DIP:DIP-14_W7.62mm',
  },
  cd4017: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '4xxx:4017',
    kicadFootprint: 'Package_DIP:DIP-16_W7.62mm',
  },
  cd4511: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: '4xxx:4511',
    kicadFootprint: 'Package_DIP:DIP-16_W7.62mm',
  },
  pcf8574: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Interface_Expansion:PCF8574',
    kicadFootprint: 'Package_DIP:DIP-16_W7.62mm',
  },
  l293d: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Driver_Motor:L293D',
    kicadFootprint: 'Package_DIP:DIP-16_W7.62mm',
  },
  optocoupler: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Isolator:4N35',
    kicadFootprint: 'Package_DIP:DIP-6_W7.62mm',
  },

  // ── I2C sensor modules ────────────────────────────────────────
  ssd1306: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Display_Graphic:SSD1306',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical',
  },
  ds3231: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Timer_RTC:DS3231M',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical',
  },
  mpu6050: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor_Motion:MPU-6050',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical',
  },
  bmp280: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor_Pressure:BMP280',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical',
  },
  dht11: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor:DHT11',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
  },
  dht22: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor:DHT22',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
  },
  vl53l0x: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor_Distance:VL53L0X',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical',
  },

  // ── MCU boards ────────────────────────────────────────────────
  arduino_uno: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'MCU_Module:Arduino_UNO_R3',
    kicadFootprint: 'Module:Arduino_UNO_R3',
  },
  arduino_nano: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'MCU_Module:Arduino_Nano_v3.x',
    kicadFootprint: 'Module:Arduino_Nano',
  },
  pi_pico: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'MCU_RaspberryPi_and_Boards:Pico',
    kicadFootprint: 'Module:RaspberryPi_Pico',
  },
  attiny85: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'MCU_Microchip_ATtiny:ATtiny85-20PU',
    kicadFootprint: 'Package_DIP:DIP-8_W7.62mm',
  },

  // ── Connectors / misc ─────────────────────────────────────────
  char_lcd: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Display_Character:HD44780',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x16_P2.54mm_Vertical',
  },
  char_lcd_i2c: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Display_Character:HD44780_I2C',
    kicadFootprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical',
  },
  ir_receiver: {
    refdesPrefix: 'U', spiceCard: 'X',
    kicadSymbol: 'Sensor_Optical:TSOP17xx',
    kicadFootprint: 'OptoDevice:Vishay_MOLD-3Pin',
  },
};
