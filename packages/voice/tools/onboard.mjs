#!/usr/bin/env node
import { runCLI } from './onboard-lib.mjs';
process.exitCode = await runCLI(process.argv.slice(2));
