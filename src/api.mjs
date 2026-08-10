/**
 * Doclify Guardrail — Programmatic API
 *
 * V2 contract (implemented for explicit check/changed consumers):
 *   import { check } from 'doclify-guardrail/api';
 *
 *   const result = await check({ paths: ['README.md'] });
 *
 */

import { check } from './core.mjs';

export { check };
