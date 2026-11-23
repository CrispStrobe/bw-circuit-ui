/**
 * Asset URLs of the vendored bw-parts art the canvas draws as part faces
 * (src/model/part-art.js ART_FACE_KINDS). Static imports, like the MakeCode
 * board art in BoardCanvas: Vite and Lite's Webpack both turn them into URLs,
 * where import.meta.glob would work in Vite only. Drawn through <image>, so
 * the art's own ids and styles stay inside it.
 */
import antenna from '../parts-data/antenna.svg';
import earth from '../parts-data/earth.svg';
import ferrite_coil from '../parts-data/ferrite_coil.svg';
import vhf_coil from '../parts-data/vhf_coil.svg';
import varicap from '../parts-data/varicap.svg';
import earphone from '../parts-data/earphone.svg';
import speaker from '../parts-data/speaker.svg';
import oscilloscope from '../parts-data/oscilloscope.svg';
import function_gen from '../parts-data/function_gen.svg';
import polarized_cap from '../parts-data/polarized_cap.svg';

export const PART_ART_URLS = Object.freeze({
  antenna, earth, ferrite_coil, vhf_coil, varicap, earphone, speaker, oscilloscope, function_gen, polarized_cap,
});
