const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
require('dotenv').config({path:'.env.services.local',quiet:true});
const audio=process.argv[2];
if(!audio || !fs.existsSync(audio) || !/\.(mp3|wav)$/i.test(audio)) { console.error('Usage: npm run test:service -- /absolute/path/to/nonduplicate-pass-sample.wav');process.exit(1); }
if(!process.env.MYSQL_ROOT_PASSWORD) {console.error('Run npm run local:setup first.');process.exit(1);}
// All DB mutations are restricted to a disposable database inside local Compose.
const result=spawnSync(process.execPath,['--test','tests/blockchain-e2e.test.cjs'],{stdio:'inherit',env:{...process.env,CHAIN_TEST:'1',SERVICE_AUDIO:path.resolve(audio),SCHEMA_TEST_MYSQL_SOCKET:'/var/run/mysqld/mysqld.sock',SCHEMA_TEST_MYSQL_BIN:path.resolve('scripts/mysql-local-test.sh'),SCHEMA_TEST_DATABASE_URL:`mysql://root:${encodeURIComponent(process.env.MYSQL_ROOT_PASSWORD)}@127.0.0.1:33306/track_ai_test`}});
process.exitCode=result.status??1;
