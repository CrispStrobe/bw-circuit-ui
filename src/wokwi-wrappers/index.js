/**
 * React 18 wrappers for @wokwi/elements via @lit/react.
 *
 * React 18 passes props as HTML attributes (strings), not DOM properties.
 * @lit/react creates proper wrappers that set JS properties on the custom element.
 */

import { createComponent } from '@lit/react';
import React from 'react';

// Import the element classes — each self-registers its custom element tag.
import { LEDElement } from '@wokwi/elements/dist/esm/led-element.js';
import { ResistorElement } from '@wokwi/elements/dist/esm/resistor-element.js';
import { PotentiometerElement } from '@wokwi/elements/dist/esm/potentiometer-element.js';
import { BuzzerElement } from '@wokwi/elements/dist/esm/buzzer-element.js';
import { PushbuttonElement } from '@wokwi/elements/dist/esm/pushbutton-element.js';
import { SevenSegmentElement } from '@wokwi/elements/dist/esm/7segment-element.js';
import { LCD1602Element } from '@wokwi/elements/dist/esm/lcd1602-element.js';
import { IRReceiverElement } from '@wokwi/elements/dist/esm/ir-receiver-element.js';

export const WokwiLed = createComponent({
  tagName: 'wokwi-led',
  elementClass: LEDElement,
  react: React,
});

export const WokwiResistor = createComponent({
  tagName: 'wokwi-resistor',
  elementClass: ResistorElement,
  react: React,
});

export const WokwiPotentiometer = createComponent({
  tagName: 'wokwi-potentiometer',
  elementClass: PotentiometerElement,
  react: React,
  events: {
    onInput: 'input',
  },
});

export const WokwiBuzzer = createComponent({
  tagName: 'wokwi-buzzer',
  elementClass: BuzzerElement,
  react: React,
});

export const WokwiPushbutton = createComponent({
  tagName: 'wokwi-pushbutton',
  elementClass: PushbuttonElement,
  react: React,
  events: {
    onButtonPress: 'button-press',
    onButtonRelease: 'button-release',
  },
});

export const WokwiSevenSegment = createComponent({
  tagName: 'wokwi-7segment',
  elementClass: SevenSegmentElement,
  react: React,
});

export const WokwiLcd1602 = createComponent({
  tagName: 'wokwi-lcd1602',
  elementClass: LCD1602Element,
  react: React,
});

export const WokwiIrReceiver = createComponent({
  tagName: 'wokwi-ir-receiver',
  elementClass: IRReceiverElement,
  react: React,
});
