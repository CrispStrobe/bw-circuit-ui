/**
 * PartPalette — categorized sidebar with search, drag-to-add.
 *
 * Every part kind that BoardCanvas can render should be here.
 * Parts with minimal electrical models are labeled "(drawable)".
 */

import React, { useEffect, useRef, useState } from 'react';
import { PartThumbnail } from './PartThumbnail.jsx';
import { paletteText, paletteUi, ledColorName } from '../i18n/palette-de.js';
import { MICROTRONIC_EXAMPLES } from '../model/microtronic-demo.js';
import { KIM1_EXAMPLES } from '../model/kim1-demo.js';

const LED_COLORS = ['red', 'green', 'yellow', 'blue', 'white', 'orange'];

const CATEGORIES = [
  {
    name: 'Boards',
    parts: [
      { kind: 'breadboard', label: 'Breadboard', params: {}, color: '#e8e4d8',
        tooltip: 'Full-size breadboard (63 columns) - legs snap into holes, rows and rails conduct' },
      { kind: 'breadboard', label: 'Breadboard ½', params: { size: 'half' }, color: '#e8e4d8',
        tooltip: 'Half-size breadboard (30 columns) with power rails' },
      { kind: 'breadboard', label: 'Breadboard mini', params: { size: 'mini' }, color: '#e8e4d8',
        tooltip: 'Mini 170-point breadboard (17 columns) - no power rails, like the real one' },
      { kind: 'arduino_uno', label: 'Arduino Uno', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'ATmega328P board — 5 V logic, digital and analog headers' },
      { kind: 'arduino_nano', label: 'Arduino Nano', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'ATmega328P Nano board — 5 V logic, compact headers' },
      { kind: 'arduino_mega', label: 'Arduino Mega', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'ATmega2560 board — 5 V logic, 54 digital and 16 analog pins' },
      { kind: 'pi_pico', label: 'Raspberry Pi Pico', params: {}, color: '#7b2cbf',
        capability: 'RP2040 simulation',
        tooltip: 'RP2040 board — 3.3 V logic, GPIO simulation; do not connect 5 V signals' },
      { kind: 'tang_nano_20k', label: 'Sipeed Tang Nano 20K', params: {}, color: '#b8860b',
        capability: 'FPGA board part (no simulation yet)',
        tooltip: 'Gowin GW2AR-18 FPGA board — 3.3 V banks, NOT 5 V tolerant; its 5V pin is a power output' },
      { kind: 'pybadge', label: 'Adafruit PyBadge', params: {}, color: '#512da8',
        capability: 'Arcade controls + wiring',
        tooltip: 'ATSAMD51J19 game board — 160×128 TFT, controls, Feather and STEMMA connections; 3.3 V only' },
      { kind: 'esp32_4848s040', label: 'ESP32-4848S040', params: {}, color: '#123b39',
        capability: 'Board wiring; display requires emulator',
        tooltip: 'GUITION C_I panel — rear H1 only, 3.3 V GPIO and 5 V board power; 480×480 display/touch uses an explicitly bound emulator' },
      { kind: 'calliopemini', label: 'Calliope mini', params: {}, color: '#044854',
        capability: 'MakeCode pins',
        tooltip: 'nRF51822 board — pads P0–P3 (P1/P2 analog, all four touch), 3V and GND; 3.3 V logic' },
      { kind: 'circuit_playground_express', label: 'Circuit Playground Express', params: {}, color: '#111111',
        capability: 'MakeCode pins',
        tooltip: 'ATSAMD21 board — pads A0–A7 (A1–A7 touch, A0 true analog out), 3.3V, GND, VOUT; 3.3 V logic' },
      { kind: 'kosmos-cp1', label: 'Kosmos CP1', params: {expansion: false, clockHz: 6000000},
        color: '#e4a138', capability: '8049 trainer',
        tooltip: 'CP1 system connector. Ports 1/2; CP3 enables ports 3/4/5. Use the built-in monitor or import a ROM in the debugger.' },
      { kind: 'kim-1', label: 'KIM-1', params: {program: KIM1_EXAMPLES[0].source, clockHz: 100},
        color: '#507e61', capability: '6502 trainer',
        tooltip: 'KIM-1 learning computer. Six-digit display, hex keypad, NMOS 6502 programs and 15 user I/O pins. Opens live KIM-1 controls.' },
      { kind: 'busch-microtronic', label: 'Busch Microtronic 2090',
        params: {program: MICROTRONIC_EXAMPLES[0].source, instructionHz: 20}, color: '#d99432',
        capability: 'Behavioral model',
        tooltip: '4-bit learning computer. Hex keypad, 256 program words, four inputs and outputs, 1 Hz clock. Opens live Microtronic controls.' },
      { kind: 'kosmos-cp1', label: 'Kosmos CP1 + CP3', params: {expansion: true, clockHz: 6000000},
        color: '#e4a138', capability: '8049 trainer',
        tooltip: 'CP1 with 256 program cells and ports 3/4/5. Use the built-in monitor or import a ROM in the debugger.' },
    ],
  },
  {
    name: 'Chips',
    parts: [
      { kind: 'attiny88_qfn32', label: 'ATtiny88 QFN-32', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'Surface-mount ATtiny88 package used by Blinkenrocket — includes PA0/ADC6 and PA1/ADC7' },
      { kind: 'attiny2313', label: 'ATtiny2313', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'DIP-20 MCU — 2 KB flash, UART (PD0/PD1), no ADC' },
      { kind: 'attiny13', label: 'ATtiny13', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'DIP-8 MCU — 1 KB flash, 4-ch ADC, Timer0' },
      { kind: 'at89c2051', label: 'AT89C2051', params: {}, color: '#7f8c8d',
        capability: 'wiring only',
        tooltip: 'DIP-20 8051-core — 2 KB flash, UART, 15 I/O (emu config pending)' },
      { kind: 'i8086', label: 'Intel 8086', params: {}, color: '#7f8c8d',
        capability: 'i8086 simulation',
        tooltip: 'DIP-40 16-bit CPU — no GPIO of its own; I/O goes through an 8255 on the bus' },
      { kind: 'i8255', label: '8255 PPI', params: {}, color: '#7f8c8d',
        capability: 'i8086 simulation',
        tooltip: 'Programmable Peripheral Interface — 24 I/O pins in three ports (A/B/C)' },
    ],
  },
  {
    name: 'Power',
    parts: [
      { kind: 'vsource', label: '9V Battery', color: '#f4d03f',
        params: { variant: '9v', volts: 9 }, tooltip: 'Real battery - click to adjust voltage' },
      { kind: 'vsource', label: 'AA Battery', color: '#b03a2e',
        params: { variant: 'aa', volts: 1.5 }, tooltip: '1.5 V cell' },
      { kind: 'vsource', label: 'Coin Cell', color: '#d5d8dc',
        params: { variant: 'coin', volts: 3 }, tooltip: '3 V lithium coin cell' },
      { kind: 'vsource', label: 'Bench Supply', color: '#e74c3c',
        params: { variant: 'bench', volts: 5, iLimit: 0.5 },
        tooltip: 'Adjustable DC supply — CV/CC mode, turn up voltage and watch current clamp' },
      { kind: 'vcc', label: '+5V post', params: { volts: 5 }, color: '#e74c3c',
        tooltip: 'Bench supply binding post — editable voltage (default 5 V)' },
      { kind: 'gnd', label: 'GND post', params: {}, color: '#3498db',
        tooltip: 'Bench supply binding post (ground)' },
    ],
  },
  {
    name: 'Passive',
    parts: [
      { kind: 'resistor', label: 'Resistor 1kΩ', params: { ohms: 1000 }, color: '#e67e22' },
      // The thermal model is OPT-IN per part (bw-board src/thermal.js): rth
      // (K/W to the air) and thermalTau (s) make a part warm up from what it
      // dissipates; a part whose heatedBy names this one feels a share
      // (thermalCoupling 0..1) of its rise. The params ride here so the
      // inspector shows them.
      { kind: 'resistor', label: 'Heater 100Ω', params: { ohms: 100, rth: 100, thermalTau: 10 }, color: '#c0392b',
        tooltip: 'Resistor that warms up from its own power: rth (K/W) and thermalTau (s). Set heatedBy on a sensor to the id of this part to heat it' },
      { kind: 'capacitor', label: 'Capacitor 100µF', params: { farads: 0.0001 }, color: '#34495e' },
      { kind: 'polarized_cap', label: 'Electrolytic 100µF', params: { farads: 0.0001 }, color: '#2c3e50',
        tooltip: 'Polarized capacitor — + lead to the more positive side; reverse bias is flagged' },
      { kind: 'inductor', label: 'Inductor 10mH', params: { henrys: 0.01 }, color: '#9b59b6', tooltip: 'Coil' },
      // A coil you wind yourself (bw-board air_coil): R and L from turns, size
      // and wire; its current's field turns a compass; a magnet dropped
      // through it makes a pulse; metal nearby shifts its inductance.
      { kind: 'air_coil', label: 'Hand-wound coil', params: { turns: 200, radiusM: 0.015, lengthM: 0.03, wireMm: 0.25 }, color: '#b5651d',
        tooltip: 'Air coil wound from copper wire: its current makes a magnetic field (a compass on its axis turns), a magnet dropped through it induces a pulse, metal nearby changes its inductance' },
      // A conductor carrying the circuit's audio current whose magnetic field
      // a hand-wound pickup coil overhears (bw-board induction_loop; `pickup`
      // names the coil, the knob is the distance).
      { kind: 'induction_loop', label: 'Magnetic field source (loop)', params: { shape: 'loop', turns: 50, radiusM: 0.02, position: 0.5 }, color: '#b5651d',
        tooltip: 'A loop of wire carrying an audio current: its magnetic field reaches a hand-wound pickup coil (set its pickup), falling off with distance — the knob moves it' },
      { kind: 'induction_loop', label: 'Mains cable (two cores)', params: { shape: 'cable', spacingMm: 6, position: 0.5 }, color: '#7f8c8d',
        tooltip: 'A two-core cable: only the current it carries makes a field, and go and return nearly cancel — a pickup coil hears it only close by and only while a load is on' },
      // An electromagnet kicking a paper-clip pendulum (bw-board coil_pendulum).
      { kind: 'coil_pendulum', label: 'Coil pendulum', params: { bob: 'iron', lengthM: 0.15 }, color: '#3c3c3c',
        tooltip: 'A wound rod with a paper clip hanging beside its pole: each current pulse pulls the clip; pulses in step with its swing (about 1.3 Hz) make it swing wide' },
      // Two electrodes in air (bw-board spark_gap): breaks down at about
      // 3 kV per mm of gap, then an arc until the current dies.
      { kind: 'spark_gap', label: 'Spark gap', params: { gapMm: 1 }, color: '#9a8f74',
        tooltip: 'Two electrodes in air: nothing flows until the voltage reaches about 3 kV per millimetre of gap (plus 1.35 kV), then a spark empties whatever was charged' },
      { kind: 'diode', label: 'Diode', params: { vf: 0.7 }, color: '#95a5a6' },
      // NAMED PARTS: `params.part` names a card in bw-board's parts library, which is
      // the only home of the electrical numbers (test/parts-cards.test.js keeps every
      // card reachable from here and every sidecar free of electrical values).
      { kind: 'diode', label: '1N4148', params: { part: '1N4148' }, color: '#95a5a6', tooltip: 'Small-signal silicon diode — numbers from the parts library' },
      { kind: 'diode', label: '1N4001', params: { part: '1N4001' }, color: '#95a5a6', tooltip: 'Rectifier diode — numbers from the parts library' },
      { kind: 'diode', label: 'Germanium diode 1N34A', params: { part: '1N34A' }, color: '#95a5a6', tooltip: 'Germanium point-contact diode, the crystal-set detector: about 0.3 V forward — numbers from the parts library' },
      { kind: 'zener', label: 'Zener Diode', params: { vf: 0.7, vz: 5.1 }, color: '#e67e22', tooltip: 'Voltage regulator diode' },
      { kind: 'zener', label: '1N4733A', params: { part: '1N4733A' }, color: '#e67e22', tooltip: '5.1 V zener — numbers from the parts library' },
      // Initial contact state rides in params so the inspector offers it;
      // the engine seeds the switch's control from it (setControl still wins).
      { kind: 'switch', label: 'Switch', params: { closed: 0 }, color: '#bdc3c7' },
      { kind: 'slide_switch', label: 'Slide Switch', params: { position: 0 }, color: '#bdc3c7', tooltip: 'SPDT: position 0 = com-a, 1 = com-b' },
      { kind: 'photodiode', label: 'Photodiode', params: { vf: 0.7 }, color: '#f39c12' },
      { kind: 'solar_cell', label: 'Solar Cell', params: {}, color: '#f1c40f' },
      { kind: 'light_bulb', label: 'Light Bulb', params: {}, color: '#f39c12', tooltip: 'Resistive' },
    ],
  },
  {
    name: 'Active',
    parts: [
      { kind: 'led', label: 'LED', params: { vf: 2.0, color: 'red' }, color: '#2ecc71', hasColorPicker: true },
      { kind: 'led', label: 'Red LED (LED_RED)', params: { part: 'LED_RED', color: 'red' }, color: '#2ecc71', tooltip: 'Standard red LED — numbers from the parts library' },
      // An LED used backwards as a light sensor (bw-board led_photocurrent):
      // photoSensitivity is the photocurrent in amps at full light, and the
      // part takes the LDR's light control (0..1). An LED answers light at or
      // shorter than its own colour's wavelength.
      { kind: 'led', label: 'LED (light sensor)', params: { color: 'red', photoSensitivity: 5e-6, light: 0.5 }, color: '#2ecc71',
        tooltip: 'LED used as a light sensor: a photocurrent of photoSensitivity amps at full light; the light slider sets 0..1' },
      { kind: 'rgb_led', label: 'RGB LED', params: { vf_r: 2.0, vf_g: 2.2, vf_b: 3.0 }, color: '#e74c3c', tooltip: 'Common cathode' },
      { kind: 'neopixel', label: 'NeoPixel', params: {}, color: '#2ecc71', tooltip: 'WS2812B addressable LED' },
      { kind: 'buzzer', label: 'Buzzer', params: {}, color: '#1abc9c' },
      // Sound from the coil CURRENT (bw-board transducers): pitch and loudness
      // come from buzzerTone() — {hz, on, level, amps}. ohms + henrys are the
      // voice coil, ratedWatts sets level 1. The speaker's optional motional
      // impedance (resonanceHz, motionalOhms, qm) is off until resonanceHz is set.
      { kind: 'speaker', label: 'Speaker', params: { ohms: 8, henrys: 0.0002, ratedWatts: 0.5 }, color: '#1abc9c',
        tooltip: 'Dynamic loudspeaker, 8 Ω voice coil: loudness follows the coil current; drive it with AC (an amplifier or a coupling capacitor)' },
      { kind: 'earphone', label: 'Earphone', params: { type: 'magnetic', ohms: 2000, henrys: 0.1, ratedWatts: 0.001 }, color: '#1abc9c',
        tooltip: 'High-impedance magnetic earphone (2 kΩ): hears microwatts — the crystal-set earpiece' },
      { kind: 'earphone', label: 'Crystal earphone', params: { type: 'crystal', capacitance: 10e-9, leakOhms: 10e6, ratedWatts: 0.001 }, color: '#1abc9c',
        tooltip: 'Crystal (piezo) earphone: a capacitor with no DC path — put a resistor across it in a crystal set' },
      // A speaker or earphone that LISTENS (bw-board acoustics.js): sound at
      // soundDb (dB SPL; a slider in the stimulus panel) makes an EMF in its
      // coil, 0.5 mV/Pa for the speaker, 3 mV/Pa for the magnetic earphone.
      // `hears` + distanceCm couple it to another speaker or earphone.
      { kind: 'speaker', label: 'Speaker as microphone', params: { ohms: 8, henrys: 0.0002, ratedWatts: 0.5, soundDb: 85, soundWave: 'voice' }, color: '#1abc9c',
        tooltip: 'A loudspeaker used backwards: sound moves the cone and the coil makes a small voltage (0.5 mV per pascal). The sound panel sets how loud you speak' },
      { kind: 'earphone', label: 'Earphone as microphone', params: { type: 'magnetic', ohms: 2000, henrys: 0.1, ratedWatts: 0.001, soundDb: 85, soundWave: 'voice' }, color: '#1abc9c',
        tooltip: 'A magnetic earphone used backwards: about 3 mV per pascal. Set hears to a speaker id and distanceCm to hold it over that speaker' },
    ],
  },
  {
    // The crystal set: antenna against earth, a tuned circuit from the
    // ferrite coil and the tuning capacitor, the 1N34A (Passive) as detector.
    name: 'Radio',
    parts: [
      { kind: 'antenna', label: 'Antenna (long wire)', params: { heightM: 5, ohms: 50, farads: 200e-12 }, color: '#b87333',
        tooltip: 'Long-wire antenna: picks up the bench broadcast stations; heightM is the effective height (m). Wire its earth to the Earth part' },
      { kind: 'earth', label: 'Earth', params: { ohms: 30 }, color: '#b87333',
        tooltip: 'Earth stake: the reference the antenna works against, with its own resistance (ohms)' },
      { kind: 'tuning_cap', label: 'Tuning capacitor', params: { minFarads: 10e-12, maxFarads: 500e-12, position: 0.5 }, color: '#7f8c8d',
        tooltip: 'Variable capacitor with a knob: turn it like a pot to sweep minFarads..maxFarads and tune the station' },
      { kind: 'ferrite_coil', label: 'Ferrite-rod coil (MW)', params: { henrys: 250e-6, tap: 0.25, couplingRatio: 0.1, k: 0.98, couplingK: 0.9, q: 120 }, color: '#b87333',
        tooltip: 'Medium-wave ferrite-rod coil: main winding a–b with a tap, coupling winding c1–c2; with the tuning capacitor across a–b it tunes the MW band' },
      { kind: 'vhf_coil', label: 'Air-core coil (VHF)', params: { henrys: 0.15e-6, q: 80 }, color: '#c87533',
        tooltip: 'A few turns of copper wire: with about 18 pF it tunes the FM band near 100 MHz' },
      { kind: 'varicap', label: 'Varicap diode BB910', params: { part: 'BB910' }, color: '#95a5a6',
        tooltip: 'Tuning diode: reverse-biased, its capacitance falls as the voltage rises — tune a circuit with a pot instead of a tuning capacitor' },
      { kind: 'npn', label: 'VHF transistor BF199', params: { part: 'BF199' }, color: '#8e44ad',
        tooltip: 'NPN transistor fast enough for VHF (about 550 MHz transition frequency) — numbers from the parts library' },
      // A short coupling winding that slides along the rod (bw-board
      // slideWinding): the rod's dial moves it instead of turning the rod.
      { kind: 'ferrite_coil', label: 'Ferrite rod, sliding winding', params: { henrys: 250e-6, tap: 0.25, couplingRatio: 0.3, k: 0.98, couplingK: 0.9, q: 120, slideWinding: true, slide: 0 }, color: '#b87333',
        tooltip: 'Ferrite rod whose small winding c1–c2 slides along it: in the middle it has the most inductance, towards the end less. Wire the two windings in series one way or the other to add or subtract them' },
      // Double-balanced mixer with its own oscillator transistor (bw-board sa612).
      { kind: 'sa612', label: 'Mixer IC SA612', params: {}, color: '#2c3e50',
        tooltip: 'Double-balanced mixer — DIP-8: the outputs carry the product of the two inputs (RF on pins 1–2, the oscillator on pin 6); pins 6–7 are a transistor for its own oscillator' },
      // The VHF receiver's IF: 10.7 MHz ceramic filter and the FM IF IC.
      { kind: 'ceramic_filter', label: 'Ceramic filter 10.7 MHz', params: { hz: 10.7e6, bandwidthHz: 280e3, ohms: 330 }, color: '#2f6fb0',
        tooltip: 'Ceramic IF filter: passes 10.7 MHz ± about 140 kHz and stops the rest; in, gnd, out' },
      { kind: 'fm_if', label: 'FM IF IC (limiter + detector)', params: { quadHz: 10.7e6 }, color: '#2b2b2b',
        tooltip: 'FM IF chip: limits the 10.7 MHz IF and turns its frequency swing into audio with a quadrature detector; its dial tunes the quadrature coil' },
      { kind: 'dipole', label: 'Folded dipole (VHF)', params: { heightM: 0.95, ohms: 300, angleDeg: 0 }, color: '#8a6a3e',
        tooltip: 'Half-wave folded dipole for the FM band: strongest broadside to the station, nothing end-on; its dial turns it' },
    ],
  },
  {
    // The room's electric fields and junction noise (bw-board src/fields.js):
    // a bare wire whose knob is how close the field source is, and a
    // transistor whose base-emitter junction is driven into breakdown.
    name: 'Fields & noise',
    parts: [
      { kind: 'field_probe', label: 'Field probe (mains wiring)', params: { source: 'mains', position: 0, maxFarads: 2e-12, mainsVolts: 230, mainsHz: 50 }, color: '#b87333',
        tooltip: 'Bare wire near a live mains cable: the knob is how close (0 far, 1 on the cable); a few pF of coupling, so only a high-impedance input hums' },
      { kind: 'field_probe', label: 'Field probe (charged ruler)', params: { source: 'charge', position: 0, maxFarads: 1e-13, rodVolts: 10000 }, color: '#b87333',
        tooltip: 'Bare wire and a rubbed plastic ruler at rodVolts: the knob moves the ruler closer; a moving ruler drives a current, a still one leaves its charge' },
      { kind: 'field_probe', label: 'Touch plate (finger)', params: { source: 'body', contact: 'skin', position: 0, skinOhms: 1e6 }, color: '#b87333',
        tooltip: 'Metal plate your finger touches: the knob is the touch; your body carries a few volts of mains hum through skinOhms' },
      { kind: 'field_probe', label: 'Touch plate through paper', params: { source: 'body', contact: 'paper', position: 0, paperFarads: 20e-12 }, color: '#b87333',
        tooltip: 'Plate under a sheet of paper: the finger couples only through paperFarads; works best when the circuit runs from a mains adaptor (adaptorFarads)' },
      { kind: 'npn', label: 'Noise transistor (B-E breakdown)', params: { beta: 200, bvEbo: 7.5 }, color: '#7f8c8d',
        tooltip: 'NPN whose base-emitter junction breaks down at bvEbo volts: fed backwards through a resistor it hisses (avalanche noise); noiseFactor, noiseBandwidthHz' },
      ],
    },
    {
    // Optical links (bw-board optics.js): any LED, the IR LED or the laser
    // shines on a phototransistor / photodiode / solar cell / photo-LED
    // through a light path. A path names its emitter and receiver (from, to;
    // with neither set it links the bench's only pair) and its knob moves the
    // geometry param named by knob between knobMin and knobMax.
    name: 'Optics',
    parts: [
      { kind: 'laser_diode', label: 'Laser diode', params: {}, color: '#e8302a',
        tooltip: 'Red laser module (650 nm): lights above about 20 mA and keeps a narrow beam over metres' },
      { kind: 'ir_transmitter', label: 'IR LED', params: {}, color: '#8e44ad',
        tooltip: 'Infrared LED (940 nm): invisible, but a phototransistor sees it best' },
      { kind: 'phototransistor', label: 'Phototransistor', params: {}, color: '#f39c12',
        tooltip: 'Light-controlled transistor: collector current grows with the light on it' },
      { kind: 'light_path', label: 'Optical bench (air)', params: { from: '', to: '', medium: 'air', distanceCm: 5, angleDeg: 0, knob: 'distanceCm', knobMin: 1, knobMax: 30 }, color: '#f1c40f',
        tooltip: 'Free beam from the emitter to the receiver: the knob sets the distance (1–30 cm); light falls with the square of the distance' },
      { kind: 'light_path', label: 'Light guide (fibre)', params: { from: '', to: '', medium: 'fibre', lengthM: 1, bendRadiusCm: 0, cutQuality: 1, outGapMm: 1, knob: 'outGapMm', knobMin: 0, knobMax: 20 }, color: '#e74c3c',
        tooltip: 'Plastic light guide: bends, a rough cut, gaps, offsets and length cost light; the knob sets the gap at the receiver (0–20 mm)' },
      { kind: 'light_path', label: 'Lens on the bench', params: { from: '', to: '', medium: 'air', lensFocalCm: 10, lensAtCm: 15, distanceCm: 40, knob: 'distanceCm', knobMin: 20, knobMax: 70 }, color: '#3498db',
        tooltip: 'A lens images the LED: the receiver sees most light where 1/f = 1/u + 1/v puts the image; the knob moves the receiver' },
      { kind: 'light_path', label: 'Coloured surface', params: { from: '', to: '', medium: 'reflect', surface: 'red', distanceCm: 1, knob: 'distanceCm', knobMin: 0.3, knobMax: 5 }, color: '#c0392b',
        tooltip: 'Light reflected by a coloured surface (red, green, blue, yellow, white, black): a red surface reflects red light, a green one hardly' },
      { kind: 'light_path', label: 'Prism and slit', params: { from: '', to: '', medium: 'prism', material: 'acrylic', slitAngleDeg: 37.5, knob: 'slitAngleDeg', knobMin: 36.5, knobMax: 39.5 }, color: '#9b59b6',
        tooltip: 'A prism bends blue more than red: turn the slit (knob) across the spectrum to pick one colour' },
      { kind: 'light_path', label: 'Glass of liquid', params: { from: '', to: '', medium: 'liquid', level: 0, distanceCm: 15, knob: 'level', knobMin: 0, knobMax: 1 }, color: '#1abc9c',
        tooltip: 'A beam through a round glass: once the liquid reaches the beam it is refracted away from the receiver; the knob fills the glass' },
      { kind: 'light_path', label: 'Plucked string', params: { from: '', to: '', medium: 'string', distanceCm: 2, stringHz: 110, decayS: 1.5, pluckPeriodS: 1, knob: 'stringHz', knobMin: 80, knobMax: 330 }, color: '#d35400',
        tooltip: 'A string half in the beam: plucked, it shades the light at its own pitch; the knob tunes it (80–330 Hz)' },
    ],
  },
  {
    name: 'Transistors',
    parts: [
      { kind: 'npn', label: 'NPN', params: { beta: 100, vbe: 0.7 }, color: '#8e44ad', tooltip: '2N2222 type' },
      { kind: 'npn', label: '2N2222', params: { part: '2N2222' }, color: '#8e44ad', tooltip: 'Named NPN — numbers from the parts library' },
      { kind: 'npn', label: 'NPN thermometer', params: { beta: 100, vbe: 0.7, rth: 200, thermalTau: 10, heatedBy: '', thermalCoupling: 0.5 },
        color: '#8e44ad', tooltip: 'NPN at its own temperature: VBE falls about 2 mV per kelvin. Set heatedBy to the id of a heater' },
      { kind: 'pnp', label: 'PNP', params: { beta: 100, vbe: 0.7 }, color: '#8e44ad', tooltip: '2N2907 type' },
      { kind: 'pnp', label: '2N2907', params: { part: '2N2907' }, color: '#8e44ad', tooltip: 'Named PNP — numbers from the parts library' },
      { kind: 'nmos', label: 'N-MOSFET', params: { vth: 2.0 }, color: '#27ae60' },
      // Depletion-mode dual-gate MOSFET (bw-board dual_gate_mosfet): two
      // channel halves in series, either gate pinches it off.
      { kind: 'dual_gate_mosfet', label: 'Dual-gate MOSFET', params: { vp: -1.2, k: 0.005 }, color: '#27ae60',
        tooltip: 'Depletion-mode MOSFET with two gates: it conducts with both gates at the source and either gate, taken below about -1.2 V, pinches the channel off' },
      { kind: 'pmos', label: 'P-MOSFET', params: { vth: 2.0 }, color: '#27ae60' },
      { kind: 'tip120', label: 'TIP120', params: { beta: 1000 }, color: '#8e44ad', tooltip: 'Darlington — high beta, 2× Vbe' },
    ],
  },
  {
    name: 'I/O',
    parts: [
      { kind: 'potentiometer', label: 'Pot 10kΩ', params: { ohms: 10000 }, color: '#9b59b6' },
      { kind: 'button', label: 'Button', params: { pressed: 0 }, color: '#f39c12' },
      { kind: 'dip_switch', label: 'DIP Switch', params: { switches: 4 }, color: '#bdc3c7', tooltip: '4-position SPST' },
      { kind: 'keypad', label: '4×4 Keypad', params: {}, color: '#7f8c8d' },
      { kind: 'ir_remote', label: 'IR Remote', params: {}, color: '#c0392b', tooltip: 'Transmitter' },
      { kind: 'mcu', label: 'MCU (STC12)', params: { pins: ['P1.0', 'P1.3', 'P1.5', 'P3.2'] }, color: '#7f8c8d' },
    ],
  },
  {
    name: 'Power Control',
    parts: [
      { kind: 'relay', label: 'Relay SPDT', params: {}, color: '#e67e22' },
      { kind: 'relay_dpdt', label: 'Relay DPDT', params: {}, color: '#e67e22' },
      { kind: 'l293d', label: 'L293D', params: {}, color: '#e74c3c', tooltip: 'H-bridge motor driver — built-in flyback' },
    ],
  },
  {
    name: 'Connectors',
    parts: [
      { kind: 'header', label: '8-Pin Header', params: { pins: 8 }, color: '#7f8c8d' },
      { kind: 'usb_a', label: 'USB-A', params: {}, color: '#bdc3c7', tooltip: 'Connector — drawable' },
    ],
  },
  {
    name: 'Sensors',
    parts: [
      { kind: 'ldr', label: 'LDR', params: { rDark: 200000, rLight: 500 }, color: '#e67e22', tooltip: 'Light-dependent resistor' },
      { kind: 'ntc', label: 'NTC Thermistor', params: { rCold: 10000, rHot: 1000 }, color: '#16a085', tooltip: 'Temperature sensor' },
      { kind: 'ntc', label: 'NTC 10k (thermal)', params: { r25: 10000, beta: 3950, rth: 500, thermalTau: 10, heatedBy: '', thermalCoupling: 0.5 },
        color: '#16a085', tooltip: 'Thermistor at its own temperature (beta equation): follows the bench, its own self-heating, airflow, and the part named in heatedBy' },
      { kind: 'tmp36', label: 'TMP36', params: {}, color: '#16a085', tooltip: 'Analog temp — 10 mV/°C' },
      // Seebeck EMF E(hotC) − E(bench) (bw-board thermocouple); the hot
      // junction's temperature is a slider (match, lighter) in the stimulus panel.
      { kind: 'thermocouple', label: 'Thermocouple type K', params: { type: 'K', hotC: 25, ohms: 5 }, color: '#c0392b',
        tooltip: 'Two different metals joined at a hot junction: about 41 µV per kelvin of difference to the bench — amplify it with an op-amp' },
      { kind: 'thermocouple', label: 'Thermocouple copper/constantan', params: { type: 'T', hotC: 25, ohms: 5 }, color: '#c0392b',
        tooltip: 'A thermocouple made from a copper and a constantan wire twisted together: about 40 µV per kelvin near room temperature' },
      // Silicon PTC (bw-board ptc_sensor): R rises with temperature; with
      // surroundC it sits in surroundings of its own (a slider: fingers, ice
      // water, hot water) while the bench stays put.
      { kind: 'ptc_sensor', label: 'Silicon PTC sensor', params: { r25: 2000, surroundC: 25, thermalTau: 3 }, color: '#2c3e50',
        tooltip: 'Silicon temperature sensor: 2 kΩ at 25 °C, about 0.8 % more per kelvin. The temperature slider puts it in your fingers, ice water or hot water' },
      { kind: 'npn', label: 'NPN on a lead (thermometer)', params: { beta: 100, surroundC: 25, thermalTau: 3 }, color: '#8e44ad',
        tooltip: 'A transistor on long leads used as a thermometer: its base-emitter voltage falls about 2 mV per kelvin. The temperature slider sets its surroundings' },
      // Weighing with a ruler (bw-board bending_ruler): load in grams is a slider.
      { kind: 'bending_ruler', label: 'Ruler scale (Hall)', params: { loadG: 0, gapMm: 15, magnetAm2: 0.1 }, color: '#1f5f8b',
        tooltip: 'A steel ruler clamped at one end, a magnet at its tip over a linear Hall sensor: a load bends the ruler, the magnet comes closer, the output rises (not linearly — calibrate it)' },
      // Electrolyte between two electrodes (bw-board electrolysis_cell):
      // the battery-on-the-tongue experiment as a circuit.
      { kind: 'electrolysis_cell', label: 'Electrolyte (tongue)', params: { ohms: 2000, farads: 2e-6, onsetV: 1.7 }, color: '#d98880',
        tooltip: 'Two electrodes on a wet tongue: a resistance, and electrolysis only above about 1.7 V — then the tongue tastes it (sour at the + contact)' },
      // Salt-film humidity comb (bw-board humidity_comb): the humidity at
      // the film is a slider (breath) in the stimulus panel.
      { kind: 'humidity_comb', label: 'Humidity comb', params: { humidity: 50 }, color: '#2f6b3a',
        tooltip: 'Two copper combs under a salt film: about 10 MΩ in a room at 50 % humidity, a few kΩ when you breathe on it' },
      { kind: 'pir_sensor', label: 'PIR Sensor', params: {}, color: '#27ae60', tooltip: 'Motion detector' },
      { kind: 'ultrasonic', label: 'Ultrasonic', params: {}, color: '#3498db', tooltip: 'HC-SR04 distance sensor' },
      { kind: 'soil_moisture', label: 'Soil Moisture', params: {}, color: '#8B4513' },
      { kind: 'gas_sensor', label: 'Gas Sensor', params: {}, color: '#7f8c8d', tooltip: 'MQ series' },
      { kind: 'tilt_sensor', label: 'Tilt Sensor', params: {}, color: '#95a5a6' },
      { kind: 'dht22', label: 'DHT22', params: {}, color: '#16a085',
        tooltip: 'AM2302 — 0.1°C resolution, -40..80°C, 0-100% RH' },
      { kind: 'ky002', label: 'KY-002 Vibration', params: {}, color: '#95a5a6',
        tooltip: 'Ball-switch vibration/shock sensor module' },
    ],
  },
  {
    name: 'Motors',
    parts: [
      { kind: 'dc_motor', label: 'DC Motor', params: {}, color: '#3498db' },
      // A fan: airflowGain (m/s of air per rad/s of shaft speed) adds to the
      // airflow the thermal model reads, so it can cool a self-heated part.
      { kind: 'dc_motor', label: 'Fan', params: { airflowGain: 0.004, J: 1e-5 }, color: '#3498db',
        tooltip: 'DC motor that moves air: airflowGain (m/s per rad/s) adds to the bench airflow and cools thermal-model parts' },
      { kind: 'gearmotor', label: 'Gearmotor', params: {}, color: '#3498db' },
      // J (kg·m², rotor inertia), loadTorque (N·m) and friction (N·m·s/rad):
      // the engine's defaults, here so the inspector can load the shaft.
      { kind: 'motor_encoder', label: 'Motor + Encoder', params: { J: 5e-7, loadTorque: 0, friction: 0 }, color: '#3498db', tooltip: 'Quadrature output' },
      { kind: 'servo', label: 'Micro Servo', params: {}, color: '#f39c12' },
      { kind: 'vibration_motor', label: 'Vibration Motor', params: {}, color: '#e67e22' },
    ],
  },
  {
    name: 'Display',
    parts: [
      { kind: 'seven_segment', label: '7-Segment', params: {}, color: '#e74c3c', tooltip: 'Digit display' },
      { kind: 'char_lcd', label: 'LCD 16×2', params: {}, color: '#2980b9', tooltip: 'HD44780 parallel' },
      { kind: 'char_lcd_i2c', label: 'LCD I²C', params: {}, color: '#2980b9', tooltip: 'PCF8574 backpack' },
      { kind: 'clock_display', label: 'Clock Display', params: {}, color: '#e74c3c', tooltip: 'TM1637 4-digit' },
      { kind: 'ssd1306', label: 'OLED 128×64', params: {}, color: '#2c3e50',
        tooltip: 'SSD1306 I²C OLED — 4-pin module (VCC, GND, SDA, SCL)' },
      { kind: 'seven_seg_3', label: '3-Digit 7-Seg', params: {}, color: '#e74c3c',
        tooltip: '056SMG 3-digit — multiplexed segments + 3 commons, no colon' },
      { kind: 'seven_seg_4', label: '4-Digit 7-Seg', params: {}, color: '#e74c3c',
        tooltip: '4-digit multiplexed — shared segments + 4 commons (the Prechin A2 tube)' },
      { kind: 'matrix8x8', label: 'LED Matrix 8×8', params: {}, color: '#27ae60',
        tooltip: '1088AS scanned dot matrix — 16 pins (col0-7, row0-7)' },
      { kind: 'matrix16x8', label: 'LED Matrix 16×8', params: {}, color: '#27ae60',
        tooltip: 'Two 1088AS side by side — 24 pins (col0-15, row0-7)' },
      { kind: 'matrix9x9', label: 'LED Matrix 9×9', params: {}, color: '#27ae60',
        tooltip: '81-LED self-wired grid — 18 pins (col0-8, row0-8)' },
      { kind: 'max7219', label: 'MAX7219 Matrix', params: {}, color: '#e74c3c',
        tooltip: 'SPI 8×8 LED driver — DIN/CLK/CS, daisy-chainable' },
      { kind: 'led_matrix', label: 'LED Matrix', params: {}, color: '#27ae60', tooltip: 'drawable — 8×8' },
      { kind: 'led_cube', label: 'LED Cube 4³', params: {}, color: '#2ecc71' },
      { kind: 'bargraph', label: 'LED Bargraph', params: {}, color: '#e67e22',
        tooltip: '10-segment LED bar — 20 pins (a0-a9 anodes, k0-k9 cathodes), DIP straddle' },
      { kind: 'simplevga_card', label: 'SimpleVGA Card', params: {}, color: '#6a5acd',
        tooltip: 'gfoot SimpleVGA6502 VGA card — machine-level video (vcc, gnd, bus)' },
      { kind: 'ps2', label: 'PS/2 Keyboard', params: {}, color: '#4338ca',
        tooltip: 'Clickable 74-key Code Set 2 keyboard — d0-d7 parallel capture + DA strobe' },
    ],
  },
  {
    name: 'Logic',
    parts: [
      { kind: '74hc00', label: '74HC00 NAND', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input NAND — DIP-14' },
      { kind: '74hc02', label: '74HC02 NOR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input NOR — DIP-14' },
      { kind: '74hc04', label: '74HC04 NOT', params: {}, color: '#9b59b6', tooltip: 'Hex inverter — DIP-14' },
      { kind: '74hc08', label: '74HC08 AND', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input AND — DIP-14' },
      { kind: '74hc32', label: '74HC32 OR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input OR — DIP-14' },
      { kind: '74hc86', label: '74HC86 XOR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input XOR — DIP-14' },
      { kind: '74c922', label: '74C922 Keypad Encoder', params: {}, color: '#9b59b6',
        tooltip: '16-key matrix encoder — DIP-18, 4-bit output + data-available strobe' },
      { kind: 'cd4093', label: 'CD4093 NAND', params: {}, color: '#8e44ad', tooltip: 'Quad 2-input Schmitt NAND — CMOS DIP-14' },
    ],
  },
  {
    name: 'ICs',
    parts: [
      // NO `gain` HERE. A palette entry is a KIND, and an electrical value
      // belongs on a part's card, not in a UI list. This carried 100000
      // beside an engine default of 1e6, so every placed op-amp solved at a
      // tenth of the open-loop gain the engine documents -- a restated
      // default that had drifted from the thing it restated. An LM741's real
      // 200000 is a PART fact and wants a card; the palette's generic op-amp
      // takes the engine's own default by saying nothing.
      { kind: 'opamp', label: 'Op-Amp', params: {}, color: '#e67e22', tooltip: 'generic op-amp' },
      { kind: 'lm741', label: 'LM741', params: {}, color: '#d35400',
        tooltip: 'Real single op-amp — PDIP-8, dual supply, finite gain/bandwidth/slew and output swing' },
      { kind: 'lt1001', label: 'LT1001', params: {}, color: '#b9770e',
        tooltip: 'Real precision op-amp — PDIP-8, 5 MV/V gain, 0.8 MHz GBW, 0.25 V/µs slew and bounded output swing' },
      { kind: 'lt1006', label: 'LT1006', params: {}, color: '#9c6b22',
        tooltip: 'Real precision single-supply op-amp — SOIC-8, ground sensing, finite gain/bandwidth/slew and asymmetric output swing' },
      { kind: 'lt1007', label: 'LT1007', params: {}, color: '#a26a18',
        tooltip: 'Real low-noise precision op-amp — N8 PDIP, 20 MV/V gain, 8 MHz GBW, 2.5 V/µs slew and bounded loaded swing' },
      { kind: 'ad711', label: 'AD711', params: {}, color: '#9b5f22',
        tooltip: 'Real precision JFET-input op-amp — N-8 PDIP, 400 kV/V gain, 4 MHz GBW, 20 V/µs slew and asymmetric output swing' },
      { kind: 'lt1014', label: 'LT1014', params: {}, color: '#7d5a20',
        tooltip: 'Real quad precision op-amp — PDIP-14, four channels with shared rails, finite gain/bandwidth/slew and ground sensing' },
      { kind: 'adtl082', label: 'ADTL082', params: {}, color: '#305b72',
        tooltip: 'Real dual JFET-input op-amp — SOIC-8, shared rails, high input impedance, finite gain/bandwidth/slew and loaded swing' },
      { kind: 'lt1678', label: 'LT1678', params: {}, color: '#31556f',
        tooltip: 'Real dual low-noise precision op-amp — SOIC-8, shared rails, finite gain/bandwidth/slew and rail-to-rail output' },
      { kind: 'ad8541', label: 'AD8541', params: {}, color: '#39706d',
        tooltip: 'Real rail-to-rail op-amp — R-8 SOIC, 40 kV/V gain, 1 MHz GBW, 0.92 V/µs slew and 2.7–5.5 V operation' },
      { kind: 'ad8602', label: 'AD8602', params: {}, color: '#2f6c78',
        tooltip: 'Real dual rail-to-rail op-amp — R-8 SOIC, shared rails, 80 kV/V gain, 8.4 MHz GBW and 6 V/µs slew' },
      { kind: 'ada4522_1', label: 'ADA4522-1', params: {}, color: '#375f78',
        tooltip: 'Real zero-drift precision op-amp — R-8 SOIC, 4.5–55 V operation, 125 dB gain, 2.7 MHz GBW and 0.8 V/µs slew' },
      { kind: 'op747', label: 'OP747', params: {}, color: '#6d4c7d',
        tooltip: 'Real quad precision op-amp — SOIC-14, shared rails, high input impedance, finite gain/bandwidth/slew and loaded swing' },
      { kind: 'op07', label: 'OP07', params: {}, color: '#a66f1f',
        tooltip: 'Real precision op-amp — PDIP-8, 400 kV/V gain, 0.6 MHz GBW, 0.3 V/µs slew and bounded output swing' },
      { kind: 'op27', label: 'OP27', params: {}, color: '#8e611b',
        tooltip: 'Real low-noise precision op-amp — PDIP-8, 1.8 MV/V gain, 8 MHz GBW, 2.8 V/µs slew and bounded output swing' },
      { kind: 'adp151', label: 'ADP151', params: { vOut: 3.3 }, color: '#117864',
        tooltip: 'Real 200 mA ultralow-noise LDO — TSOT-5, fixed 3.3 V, enable, dropout and current limit' },
      { kind: 'adp7118', label: 'ADP7118', params: {}, color: '#16a085',
        tooltip: 'Real 200 mA low-noise LDO — SOIC-8, fixed/adjustable feedback, enable and current limit' },
      { kind: 'lt1763', label: 'LT1763', params: {}, color: '#148f77',
        tooltip: 'Real 500 mA low-noise LDO — SO-8, fixed/adjustable feedback, shutdown and current limit' },
      { kind: 'lm386', label: 'LM386', params: {}, color: '#7b3f00',
        tooltip: 'Audio power amplifier — PDIP-8, gain 20 (200 with 10 µF across pins 1–8), output at Vs/2, drives an 8 Ω speaker through a coupling capacitor' },
      { kind: '555', label: '555 Timer', params: {}, color: '#e74c3c' },
      // 4046-type PLL (bw-board cd4046): the VCO runs on the external R1 (pin
      // 11), C1 (pins 6-7) and optional R2 (pin 12); comparator II locks it.
      { kind: 'cd4046', label: '4046 PLL', params: {}, color: '#8e44ad',
        tooltip: 'Phase-locked loop — DIP-16: a VCO set by R1, R2 and C1, an XOR and an edge phase comparator; pin 1 is HIGH while the loop is locked' },
      { kind: 'shift_register', label: '74HC595', params: {}, color: '#8e44ad', tooltip: 'Shift register — 8 outputs' },
      { kind: 'ir_receiver', label: 'IR Receiver', params: {}, color: '#c0392b', tooltip: 'drawable — IrDA' },
      { kind: 'temp_sensor', label: 'Temp Sensor', params: {}, color: '#16a085', tooltip: 'drawable — DS18B20' },
      { kind: 'pcf8574', label: 'PCF8574', params: {}, color: '#8e44ad', tooltip: 'I²C 8-bit I/O expander' },
      { kind: 'eeprom', label: 'EEPROM', params: {}, color: '#2c3e50', tooltip: 'drawable — I²C' },
      { kind: 'at24c64', label: '24C64 EEPROM', params: {}, color: '#2c3e50', tooltip: 'I²C 8 KB EEPROM — DIP-8, address straps A0-A2, WP write-protect (blinkenrocket: SOIC-8 EIAJ)' },
      { kind: 'mcp4725', label: 'MCP4725 DAC', params: {}, color: '#27ae60',
        tooltip: '12-bit I²C DAC — analog voltage output, addr 0x60/0x62' },
    ],
  },
  {
    name: 'Instruments',
    parts: [
      // inputOhms rides in params so the inspector edits it: a 10 MΩ meter is
      // invisible on a 1 kΩ divider and moves a 1 MΩ one by 4.76 %, and a
      // lesson that wants the error large dials the meter down (D21).
      { kind: 'meter', label: 'Multimeter', params: { mode: 'voltage', inputOhms: 10e6 }, color: '#f1c40f',
        tooltip: 'V / A / Ω probe. In V mode it loads the circuit through inputOhms (10 MΩ default)' },
      // A moving-coil panel meter: coilOhms and ifs (full-scale coil current)
      // set how much it loads the circuit -- fullScale / ifs in voltage mode
      // (5 kΩ for 1 mA on 5 V), a shunt to fullScale amps in current mode.
      { kind: 'analog_meter', label: 'Analog Meter', params: { mode: 'voltage', fullScale: 5, ifs: 0.001, coilOhms: 100 }, color: '#f1c40f',
        tooltip: 'Moving-coil meter (1 mA / 100 Ω movement) — loads the circuit like the real one; mode voltage or current' },
      { kind: 'vsource', label: 'Function Gen', color: '#2ecc71',
        params: { wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 },
        tooltip: 'Waveform source - sine, square, triangle, pulse, dc; edit params after placing' },
      // The instrument itself: OUT/GND leads behind a 50 ohm output, the same
      // waveform params as the source above (bw-board function_gen device).
      { kind: 'function_gen', label: 'Function Generator', color: '#2ecc71',
        params: { wave: 'sine', freq: 1000, amplitude: 1, offset: 0, rOut: 50 },
        tooltip: 'Bench generator: out against gnd through 50 ohm; sine, square, triangle, pulse, dc' },
      { kind: 'oscilloscope', label: 'Oscilloscope', params: { inputOhms: 1e6 }, color: '#f1c40f',
        tooltip: 'Two channels (ch1, ch2) against gnd, each a 1 MOhm input: it loads the circuit like a real scope' },
      // The two dependent sources. `params` is deliberately EMPTY: bw-board's
      // stamps already default the gain and the transconductance, and a copy
      // here would be a second home for an electrical number -- the defect
      // that had 45 LDR circuits disagreeing with the solver by a factor of
      // 1,000 earlier in this programme. Place one and edit it; an untouched
      // part solves at the engine's own default.
      { kind: 'vcvs', label: 'VCVS (E)', params: {}, color: '#8e6fd8',
        tooltip: 'Ideal voltage-controlled voltage source — outp/outn follow the voltage across inp/inn times the gain. What a SPICE E card imports as.' },
      { kind: 'vccs', label: 'VCCS (G)', params: {}, color: '#16a085',
        tooltip: 'Ideal voltage-controlled current source — drives a current from outn to outp set by the voltage across inp/inn times gm. What a SPICE G card imports as.' },
    ],
  },
];

const ALL_PARTS = CATEGORIES.flatMap(c => c.parts);

const thumbnailCallbacks = new WeakMap();
let thumbnailObserver;

function PalettePartThumbnail({ kind, color, params }) {
  const container = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const target = container.current;
    // The scrolling palette clips targets outside its viewport, even when the
    // card remains mounted for keyboard navigation and search.
    thumbnailObserver ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailCallbacks.get(entry.target)?.(true);
      }
    });
    thumbnailCallbacks.set(target, setVisible);
    thumbnailObserver.observe(target);
    return () => {
      thumbnailObserver.unobserve(target);
      thumbnailCallbacks.delete(target);
    };
  }, [visible]);
  return (
    <div ref={container} style={{ width: 48, height: 48, display: 'flex' }}>
      {visible && <PartThumbnail kind={kind} color={color} params={params} />}
    </div>
  );
}

export function PartPalette({ onAddPart, onDragPart, onStartPlace, theme = 'dark', lang = 'en', headingControl }) {
  const [filter, setFilter] = useState('');
  const [ledColor, setLedColor] = useState('red');
  const light = theme === 'light';
  const palette = light ? {
    background: '#f8fafc', border: '#cbd5e1', text: '#1e293b', input: '#fff',
    inputText: '#334155', category: '#475569', card: '#fff', hover: '#e0f2fe',
    cardBorder: '#94a3b8', muted: '#64748b'
  } : {
    background: '#172033', border: '#2c3e50', text: '#f8fafc', input: '#0b1220',
    inputText: '#f8fafc', category: '#b8c7d9', card: '#20324d', hover: '#29466a',
    cardBorder: '#6383a8', muted: '#cbd5e1'
  };

  // Search finds a part by its English AND its shown (translated) words.
  const needle = filter.toLowerCase();
  const matchingParts = filter
    ? ALL_PARTS.filter(p =>
        p.label.toLowerCase().includes(needle) ||
        paletteText(p.label, lang).toLowerCase().includes(needle) ||
        p.kind.includes(needle) ||
        (p.tooltip || '').toLowerCase().includes(needle) ||
        paletteText(p.tooltip || '', lang).toLowerCase().includes(needle))
    : null;

  return (
    <div data-parts-palette="true" style={{
      background: palette.background,
      border: `1px solid ${palette.border}`,
      borderRadius: '8px',
      padding: '8px',
      width: '100%',
      boxSizing: 'border-box',
      minWidth: 0,
      minHeight: 0,
      fontFamily: 'inherit',
      flex: '1 1 0',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ color: palette.text, fontSize: '11px', marginBottom: '4px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {headingControl}<span>{paletteUi('parts', lang)}</span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={paletteUi('search', lang)}
        aria-label={paletteUi('search', lang)}
        style={{
          width: '100%', padding: '4px 6px', marginBottom: '6px', flexShrink: 0,
          background: palette.input, border: `1px solid ${palette.cardBorder}`,
          borderRadius: '4px', color: palette.inputText,
          fontFamily: 'inherit', fontSize: '10px',
          boxSizing: 'border-box',
        }}
      />

      <div data-parts-list style={{flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        overflowX: 'hidden', scrollbarWidth: 'thin', overscrollBehavior: 'contain'}}>
        {matchingParts ? (
          matchingParts.length === 0 ? (
            <div style={{ color: palette.muted, fontSize: '9px', padding: '4px' }}>{paletteUi('noMatches', lang)}</div>
          ) : (
            matchingParts.map((p, i) => <PartButton key={`${p.kind}-${p.label}-${i}`} palette={palette} part={p} onAddPart={onAddPart} onDragPart={onDragPart} onStartPlace={onStartPlace} ledColor={ledColor} onLedColorChange={setLedColor} lang={lang} />)
          )
        ) : (
          CATEGORIES.map(cat => (
            <div key={cat.name}>
              <div style={{ color: palette.category, fontSize: '8px', marginTop: '4px', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>
                {paletteText(cat.name, lang)}
              </div>
              {cat.parts.map((p, i) => <PartButton key={`${p.kind}-${p.label}-${i}`} palette={palette} part={p} onAddPart={onAddPart} onDragPart={onDragPart} onStartPlace={onStartPlace} ledColor={ledColor} onLedColorChange={setLedColor} lang={lang} />)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PartButton({ part, palette, onAddPart, onDragPart, onStartPlace, ledColor, onLedColorChange, lang = 'en' }) {
  const { kind, params, color, hasColorPicker } = part;
  // Shown words follow the language; `part` itself (and its English) is untouched.
  const label = paletteText(part.label, lang);
  const tooltip = paletteText(part.tooltip, lang);
  const capability = paletteText(part.capability, lang);
  const [hovered, setHovered] = useState(false);

  // For LEDs, use the selected color
  const effectiveParams = kind === 'led' ? { ...params, color: ledColor } : params;
  const startPlacement = () => {
    // Arm ghost placement: press-drag-release onto the canvas, or click here
    // and click the canvas — both commit at the cursor.
    if (onStartPlace) onStartPlace(kind, effectiveParams);
    else onAddPart(kind, effectiveParams);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        data-palette-kind={kind}
        onPointerDown={startPlacement}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          startPlacement();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tooltip || label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          padding: '4px',
          marginBottom: '3px',
          background: hovered ? palette.hover : palette.card,
          border: `1px solid ${hovered ? color : palette.cardBorder}`,
          borderRadius: '6px',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'manipulation',
          boxSizing: 'border-box',
          transition: 'border-color 80ms, background 80ms',
        }}
      >
        <PalettePartThumbnail kind={kind} color={color} params={effectiveParams} />
        <div style={{
          color: palette.text,
          fontFamily: 'inherit',
          fontSize: '9px',
          textAlign: 'center',
          lineHeight: '1.2',
          marginTop: '2px',
        }}>
          {kind === 'led' ? paletteUi('led', lang, {color: ledColorName(ledColor, lang)}) : label}
        </div>
        {capability && (
          <div style={{
            color: part.capability === 'wiring only' ? '#a16207' : '#047857',
            fontSize: '7px', textAlign: 'center', marginTop: '2px',
            letterSpacing: '.02em',
          }}>
            {capability}
          </div>
        )}
        {tooltip && (
          <div style={{ color: '#a9bdd2', fontSize: '7px', textAlign: 'center' }}>{tooltip}</div>
        )}
      </div>

      {/* LED color swatch picker */}
      {hasColorPicker && (
        <div style={{ display: 'flex', gap: '2px', padding: '2px 4px', marginBottom: '2px', justifyContent: 'center' }}>
          {LED_COLORS.map(c => (
            <div
              key={c}
              onClick={() => onLedColorChange(c)}
              style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: c === 'white' ? '#eee' : c,
                border: c === ledColor ? '2px solid #fff' : '1px solid #444',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
