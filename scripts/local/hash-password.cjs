// Runtime helper only: consumes a password on stdin and returns a bcrypt hash.
const fs=require('node:fs');
const bcrypt=require(process.env.WORKPROOF_BCRYPT_JS);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(typeof input.password!=='string'||input.password.length<16)throw new Error('Invalid generated password');
process.stdout.write(bcrypt.hashSync(input.password,10));
