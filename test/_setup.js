/**
 * Test setup — inject the engine from the local bw-board copy.
 *
 * Every test file must import this before importing any model module.
 */

import { setEngine } from '../src/engine.js';
import { BoardImpl } from '../../bw-board/src/board.js';
import { inferNetlist, checkWiring } from '../../bw-board/src/infer-netlist.js';

setEngine({ BoardImpl, inferNetlist, checkWiring });
