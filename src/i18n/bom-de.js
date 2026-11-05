/**
 * German for the parts list (BomPanel.jsx), keyed by the English kind label in
 * model/bom.js KIND_LABELS.
 *
 * Generic parts get a German name; a label that is a part number or a product
 * name (74HC283 4-bit Adder, LT1007 …, Arduino Uno) keeps its English
 * description, which is also how the part is ordered. A missing entry falls
 * back to the English label. The CSV export stays English (it is a file for a
 * shop, not a view).
 */

export const BOM_DE = {
  '4-way DIP Switch (SPST)': '4-fach-DIP-Schalter (SPST)',
  '7-Segment Display': '7-Segment-Anzeige',
  'VCC Supply': 'VCC-Versorgung',
  'Ground': 'Masse',
  'Resistor': 'Widerstand',
  'Capacitor': 'Kondensator',
  'Inductor': 'Spule',
  'Diode': 'Diode',
  'Zener Diode': 'Z-Diode',
  'RGB LED': 'RGB-LED',
  'Potentiometer': 'Potentiometer',
  'Push Button': 'Taster',
  'Toggle Switch': 'Kippschalter',
  'Buzzer': 'Summer',
  'NPN Transistor': 'NPN-Transistor',
  'PNP Transistor': 'PNP-Transistor',
  'Op-Amp': 'Operationsverstärker',
  'Voltage-Controlled Voltage Source': 'Spannungsgesteuerte Spannungsquelle',
  'Voltage-Controlled Current Source': 'Spannungsgesteuerte Stromquelle',
  '555 Timer': '555-Timer',
  'Relay': 'Relais',
  'Micro Servo': 'Mikroservo',
  'DC Motor': 'Gleichstrommotor',
  'Photoresistor (LDR)': 'Fotowiderstand (LDR)',
  'NTC Thermistor': 'NTC-Thermistor',
  'LED Matrix 8×8': 'LED-Matrix 8×8',
  'IR Receiver': 'IR-Empfänger',
  'Temperature Sensor': 'Temperatursensor',
  'Multimeter': 'Multimeter',
  'DC Supply': 'Gleichspannungsquelle',
  'TIP120 Darlington': 'TIP120-Darlington',
  'Relay DPDT': 'Relais DPDT',
  'Slide Switch': 'Schiebeschalter',
  'DIP Switch': 'DIP-Schalter',
  'Photodiode': 'Fotodiode',
  'Solar Cell': 'Solarzelle',
  'Light Bulb': 'Glühlampe',
  'Gearmotor': 'Getriebemotor',
  'Vibration Motor': 'Vibrationsmotor',
  'L293D H-Bridge': 'L293D-H-Brücke',
  'Pin Header': 'Stiftleiste',
  'USB-A Connector': 'USB-A-Buchse',
  'IR Remote': 'IR-Fernbedienung',
  'PIR Motion Sensor': 'PIR-Bewegungsmelder',
  'Ultrasonic (HC-SR04)': 'Ultraschall (HC-SR04)',
  'Soil Moisture Sensor': 'Bodenfeuchtesensor',
  'Gas Sensor (MQ)': 'Gassensor (MQ)',
  'Tilt Sensor': 'Neigungssensor',
  'DHT22 Temp/Humidity': 'DHT22 Temperatur/Feuchte',
  'TMP36 Temperature': 'TMP36 Temperatur',
  'KY-002 Vibration': 'KY-002 Erschütterung',
  'Clock Display (TM1637)': 'Uhrenanzeige (TM1637)',
  '3-Digit 7-Segment': '3-stellige 7-Segment-Anzeige',
  '4-Digit 7-Segment': '4-stellige 7-Segment-Anzeige',
  'LED Matrix 16×8': 'LED-Matrix 16×8',
  'LED Matrix 9×9': 'LED-Matrix 9×9',
  'MAX7219 LED Driver': 'MAX7219-LED-Treiber',
  'LED Cube 4³': 'LED-Würfel 4³',
  '4×4 Keypad': '4×4-Tastenfeld',
  'PCF8574 I/O Expander': 'PCF8574-E/A-Erweiterung',
};

export const BOM_UI = {
  en: {empty: 'No parts to list', title: 'Bill of Materials ({n} parts)', qty: 'Qty', part: 'Part',
    legend: '{kind} legend SVG', legendTitle: 'Download printable {kind} pin legend', header: 'header',
    unspecified: ' (package unspecified by source)'},
  de: {empty: 'Keine Bauteile aufzulisten', title: 'Stückliste ({n} Bauteile)', qty: 'Anz.', part: 'Bauteil',
    legend: '{kind}-Legende (SVG)', legendTitle: 'Druckbare Pin-Legende für {kind} herunterladen', header: 'Stiftleiste',
    unspecified: ' (Gehäuse von der Quelle nicht angegeben)'},
};

export const bomUi = (key, lang, vars) => {
  const table = /^de/i.test(String(lang || '')) ? BOM_UI.de : BOM_UI.en;
  let s = table[key] ?? BOM_UI.en[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, String(v));
  return s;
};

/**
 * A BOM line's label for `lang`. `kindLabel` is the English KIND_LABELS entry
 * the line's label starts with; only that leading name and the "package
 * unspecified" note are replaced, so values and order codes stay as they are.
 */
export function bomLabel(line, kindLabel, lang) {
  const label = String(line?.label ?? '');
  if (!/^de/i.test(String(lang || '')) || line?.carrier) return label;
  let out = label;
  if (kindLabel && BOM_DE[kindLabel] && out.startsWith(kindLabel)) {
    out = BOM_DE[kindLabel] + out.slice(kindLabel.length);
  }
  return out.replace(BOM_UI.en.unspecified, BOM_UI.de.unspecified);
}
