<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="6.4"><drawing><schematic>
 <parts>
  <part name="R1" library="resistor" deviceset="R-EU_" device="0207/10" value="4k7"/>
  <part name="C1" library="resistor" deviceset="C-EU" device="050-024X044" value="100n"/>
  <part name="D1" library="ipc-7351-diode" deviceset="DIODE_" device="" value="1N4148"/>
  <part name="GND1" library="SparkFun-Aesthetics" deviceset="GND" device=""/>
  <part name="P1" library="SparkFun-Aesthetics" deviceset="VCC" device=""/>
  <part name="J1" library="SparkFun-Connectors" deviceset="AUDIO-JACK" device=""/>
 </parts>
 <sheets><sheet><nets>
  <net name="VCC"><segment>
    <pinref part="P1" gate="G$1" pin="VCC"/>
    <pinref part="R1" gate="G$1" pin="1"/>
  </segment></net>
  <net name="N$1"><segment>
    <pinref part="R1" gate="G$1" pin="2"/>
    <pinref part="D1" gate="G$1" pin="A"/>
    <pinref part="C1" gate="G$1" pin="1"/>
  </segment></net>
  <net name="GND"><segment>
    <pinref part="D1" gate="G$1" pin="K"/>
    <pinref part="C1" gate="G$1" pin="2"/>
    <pinref part="GND1" gate="1" pin="GND"/>
  </segment></net>
 </nets></sheet></sheets>
</schematic></drawing></eagle>