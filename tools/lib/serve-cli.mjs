#!/usr/bin/env node
/** 개발용: 정적 서버를 띄우고 URL을 출력한 채 유지한다 (Ctrl-C 종료) */
import { startServer } from './server.mjs';

const server = await startServer();
console.log(`serving repo at ${server.url} (mode=realtime 기본, ?mode=fixed 하네스)`);
