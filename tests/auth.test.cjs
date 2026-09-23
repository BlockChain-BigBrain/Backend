const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.COOKIE_SECURE = 'true';
process.env.FRONTEND_URL = 'http://localhost:3000';
const jwt = require('jsonwebtoken');
const { AuthService } = require('../dist/services/auth.service');
const { AuthController, safeRedirectPath } = require('../dist/controllers/auth.controller');
const { requireAuth } = require('../dist/middlewares/auth.middleware');
function fixture() {
  const user = { id: 1, email: 'a@example.com', name: 'A', refreshTokenHash: null };
  const users = {
    findOrCreateGoogleUser: async () => user,
    findById: async () => user,
    setRefreshHash: async (_, hash) => { user.refreshTokenHash = hash; },
    replaceRefreshHash: async (_, previous, next) => {
      if (user.refreshTokenHash !== previous) return { count: 0 };
      user.refreshTokenHash = next; return { count: 1 };
    },
  };
  const google = {
    generateAuthUrl: ({ state }) => `https://accounts.google.com/?state=${state}`,
    getToken: async () => ({ tokens: { id_token: 'verified-by-mock' } }),
    verifyIdToken: async () => ({ getPayload: () => ({ sub: '123', email: user.email, email_verified: true }) }),
  };
  return { user, service: new AuthService(users, google), google };
}
function response() {
  return { cookies: {}, cleared: [], headers: {}, cookie(n,v,o){ this.cookies[n] = {value:v, options:o}; return this; },
    clearCookie(n){ this.cleared.push(n); return this; }, setHeader(n,v){ this.headers[n]=v; },
    redirect(url){ this.location=url; }, json(body){this.body=body;}, status(code){this.code=code;return this;},end(){} };
}
test('refresh rotation uses unique tokens and rejects replay, including concurrent requests', async () => {
  const { service, user } = fixture();
  const first = await service.completeGoogleLogin('code');
  assert.match(user.refreshTokenHash, /^\$2[aby]\$12\$/);
  const outcomes = await Promise.allSettled([service.refresh(first.refreshToken), service.refresh(first.refreshToken)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const second = outcomes.find(r => r.status === 'fulfilled').value;
  assert.notEqual(first.refreshToken, second.refreshToken);
  await assert.rejects(service.refresh(first.refreshToken), {statusCode:401});
  await service.logout(first.refreshToken);
  await service.refresh(second.refreshToken);
});
test('logout revokes the current refresh token and is idempotent', async () => {
  const { service } = fixture(); const pair = await service.completeGoogleLogin('code');
  await service.logout(pair.refreshToken); await service.logout(pair.refreshToken);
  await assert.rejects(service.refresh(pair.refreshToken), {statusCode:401});
  await assert.rejects(service.refresh(pair.accessToken), {statusCode:401});
  await assert.rejects(service.refresh(), {statusCode:401});
});
test('access middleware rejects refresh, malformed and expired tokens', async () => {
  const { service } = fixture(); const pair = await service.completeGoogleLogin('code');
  for (const token of [pair.refreshToken, 'bad', jwt.sign({userId:1, tokenType:'access'}, process.env.JWT_ACCESS_SECRET, {expiresIn:-1})]) {
    requireAuth({headers:{authorization:`Bearer ${token}`}}, {}, error => assert.equal(error.statusCode,401));
  }
  const req={headers:{authorization:`Bearer ${pair.accessToken}`}};
  requireAuth(req,{}, error => assert.equal(error, undefined)); assert.equal(req.userId,1);
});
test('OAuth callback binds state to browser, consumes it, and only sends refresh cookie', async () => {
  const { service } = fixture(); const controller = new AuthController(service);
  const start=response(); await controller.startGoogle({headers:{},query:{redirectTo:'/dashboard'}},start);
  const state=start.cookies.oauthState.value;
  assert.equal(start.cookies.oauthState.options.sameSite,'lax');
  const req={headers:{cookie:`oauthState=${state}`},query:{state,code:'code'}};
  const done=response(); await controller.callbackGoogle(req,done);
  assert.equal(done.location,'http://localhost:3000/dashboard');
  assert.equal(done.cookies.refreshToken.options.httpOnly,true);
  assert.equal(done.cookies.refreshToken.options.sameSite,'none');
  assert.equal(done.body,undefined);
  const replay=response(); await controller.callbackGoogle(req,replay);
  assert.match(replay.location,/INVALID_STATE/);
});
test('invalid state never exchanges a code; Google denial redirects safely', async () => {
  const {service,google}=fixture(); let exchanges=0;google.getToken=async()=>{exchanges++;throw new Error();};
  const c=new AuthController(service); const bad=response();
  await c.callbackGoogle({headers:{},query:{state:'bad',code:'bad'}},bad);
  assert.match(bad.location,/INVALID_STATE/);assert.equal(exchanges,0);
  const start=response();await c.startGoogle({headers:{},query:{}},start);const state=start.cookies.oauthState.value;
  const denied=response();await c.callbackGoogle({headers:{cookie:`oauthState=${state}`},query:{state,error:'access_denied'}},denied);
  assert.match(denied.location,/ACCESS_DENIED/);assert.equal(exchanges,0);
});
test('redirect paths reject external origins, backslashes and whitespace', () => {
  for(const path of ['https://evil.test','//evil.test','/\\evil.test','/\t/evil.test']) assert.equal(safeRedirectPath(path),'/auth/callback');
  assert.equal(safeRedirectPath('/dashboard?a=1'),'/dashboard?a=1');
});
test('refresh blocks untrusted origin and public user response excludes token hashes', async () => {
  const {service}=fixture();const c=new AuthController(service);
  await assert.rejects(c.refresh({headers:{origin:'https://evil.test'}},response()),{statusCode:403});
  assert.deepEqual(Object.keys(await service.me(1)).sort(),['email','id','nickname']);
});
test('unverified Google email cannot create a session', async () => {
  const {service,google}=fixture();google.verifyIdToken=async()=>({getPayload:()=>({sub:'123',email:'a@example.com',email_verified:false})});
  await assert.rejects(service.completeGoogleLogin('code'),{statusCode:401});
});

test('Swagger login returns to fixed docs URL and refresh allows configured backend origin', async () => {
  const {service}=fixture();const controller=new AuthController(service);
  const start=response();await controller.startGoogle({headers:{},query:{target:'swagger',redirectTo:'https://evil.test'}},start);
  const state=start.cookies.oauthState.value;const done=response();
  await controller.callbackGoogle({headers:{cookie:`oauthState=${state}`},query:{state,code:'code'}},done);
  assert.equal(done.location,'/api-docs/?login=success');
  const {config}=require('../dist/config');const refreshed=response();
  await controller.refresh({headers:{origin:new URL(config.googleCallbackUrl).origin,cookie:`refreshToken=${done.cookies.refreshToken.value}`}},refreshed);
  assert.ok(refreshed.body.result.accessToken);
});

test('local signup normalizes identity, hashes passwords and rejects duplicates', async () => {
  const bcrypt = require('bcryptjs');
  let stored;
  const users = {
    findByEmail: async email => stored?.email === email ? stored : null,
    createLocalUser: async data => (stored = { id: 2, ...data, name: data.nickname, provider: 'LOCAL' }),
    setRefreshHash: async (_, hash) => { stored.refreshTokenHash = hash; },
  };
  const service = new AuthService(users);
  const input = { email: ' Fan@Example.com ', password: 'password123', nickname: ' 음악팬 ' };
  assert.deepEqual(await service.signUp(input), { id: 2, email: 'fan@example.com', nickname: '음악팬' });
  assert.notEqual(stored.passwordHash, input.password);
  assert.equal(await bcrypt.compare(input.password, stored.passwordHash), true);
  await assert.rejects(service.signUp(input), { statusCode: 409 });
  await assert.rejects(service.logIn({ email: input.email, password: 'wrong' }), { statusCode: 401 });
  const pair = await service.logIn(input);
  const payload = jwt.verify(pair.accessToken, process.env.JWT_ACCESS_SECRET);
  assert.equal(payload.sub, '2');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(stored.refreshTokenHash);
  stored.provider = 'GOOGLE';
  await assert.rejects(service.logIn(input), { statusCode: 401 });
});

test('signup translates database uniqueness races to 409', async () => {
  const service = new AuthService({ findByEmail: async () => null, createLocalUser: async () => { throw {code:'P2002'}; } });
  await assert.rejects(service.signUp({email:'a@example.com',password:'password123',nickname:'테스트'}), {statusCode:409});
});

test('credential validation rejects malformed input and bcrypt truncation', () => {
  const {validateCredentials} = require('../dist/dto/auth.dto');
  const valid = {email:'a@example.com', password:'password123', nickname:'테스트'};
  for (const input of [null, [], {...valid, email:'bad'}, {...valid,password:'short'}, {...valid,password:'가'.repeat(25)}, {...valid,nickname:'  '}, {...valid,preferredLanguage:'xx'}, {...valid,provider:'GOOGLE'}]) {
    assert.throws(() => validateCredentials(input,true), {statusCode:400});
  }
  assert.deepEqual(validateCredentials(valid,true), {...valid, preferredLanguage:undefined});
});

test('local controller returns envelope and keeps refresh token only in the scoped cookie', async () => {
  const controller = new AuthController({
    signUp: async () => ({id:2,email:'a@example.com',nickname:'테스트'}),
    logIn: async () => ({accessToken:'access',refreshToken:'refresh'}),
    logout: async () => {},
  });
  const req = {headers:{origin:'http://localhost:3000'},body:{email:'a@example.com',password:'password123'}};
  const signed = response();
  await controller.signUp({...req,body:{...req.body,nickname:'테스트'}},signed);
  assert.equal(signed.code,201);
  assert.equal(signed.body.isSuccess,true);
  const logged = response(); await controller.logIn(req,logged);
  assert.deepEqual(logged.body.result,{accessToken:'access'});
  assert.equal(logged.cookies.refreshToken.value,'refresh');
  assert.equal(logged.cookies.refreshToken.options.path,'/api/v1/auth');
  assert.equal(logged.cookies.refreshToken.options.maxAge,14*86400000);
  const out=response(); await controller.logout(req,out);
  assert.equal(out.body.result,null);
  assert.ok(out.cleared.includes('refreshToken'));
  await assert.rejects(controller.logIn({...req,headers:{origin:'https://evil.test'}},response()),{statusCode:403});
});

test('Google identity cannot automatically link a local email account', async () => {
  const {UserRepository} = require('../dist/repositories/user.repository');
  let writes = 0;
  const repository = new UserRepository({user:{
    findUnique: async ({where}) => where.googleId ? null : {id:1,provider:'LOCAL'},
    upsert: async () => { writes++; },
  }});
  await assert.rejects(repository.findOrCreateGoogleUser({googleId:'sub',email:'a@example.com',name:'A'}),{statusCode:409});
  assert.equal(writes,0);
});

test('frontend refresh ignores Swagger cookies and uses its own cookie for rotation and logout', async () => {
  const seen = [];
  const controller = new AuthController({
    refresh: async token => { seen.push(token); if (!token) throw Object.assign(new Error(), {statusCode:401}); return {accessToken:'access',refreshToken:'rotated'}; },
    logout: async token => { seen.push(token); },
  });
  const req = {query:{target:'frontend'},headers:{cookie:'refreshToken=swagger'}};
  await assert.rejects(controller.refresh(req,response()),{statusCode:401});
  req.headers.cookie += '; frontendRefreshToken=frontend';
  const renewed = response(); await controller.refresh(req,renewed);
  assert.equal(renewed.cookies.frontendRefreshToken.value,'rotated');
  assert.equal(renewed.cookies.refreshToken,undefined);
  const out = response(); await controller.logout(req,out);
  assert.deepEqual(out.cleared,['frontendRefreshToken']);
  assert.deepEqual(seen,[undefined,'frontend','frontend']);
});

test('frontend Google login sets only the frontend session cookie', async () => {
  const {service} = fixture(); const controller = new AuthController(service);
  const start=response(); await controller.startGoogle({headers:{},query:{target:'frontend'}},start);
  const state=start.cookies.oauthState.value; const done=response();
  await controller.callbackGoogle({headers:{cookie:`oauthState=${state}`},query:{state,code:'code'}},done);
  assert.ok(done.cookies.frontendRefreshToken);
  assert.equal(done.cookies.refreshToken,undefined);
  assert.equal(done.location,'http://localhost:3000/auth/callback');
});


test('trusted cross-site frontend can refresh but foreign and missing origins cannot', async () => {
  const controller = new AuthController({refresh: async () => ({accessToken:'access',refreshToken:'refresh'})});
  const req = {query:{target:'frontend'},headers:{origin:'http://localhost:3000','sec-fetch-site':'cross-site'}};
  const renewed = response();
  await controller.refresh(req, renewed);
  assert.equal(renewed.cookies.frontendRefreshToken.options.sameSite, 'none');
  assert.equal(renewed.cookies.frontendRefreshToken.options.secure, true);
  for (const origin of ['https://evil.test', 'null', undefined]) {
    await assert.rejects(controller.refresh({...req,headers:{...req.headers,origin}},response()),{statusCode:403});
  }
});

test('GitHub Pages OAuth success and denial return to the existing base page', async () => {
  const {service} = fixture(); const controller = new AuthController(service);
  for (const denied of [false, true]) {
    const start = response();
    await controller.startGoogle({headers:{},query:{target:'frontend',redirectTo:'/Frontend/?login=success'}},start);
    const state = start.cookies.oauthState.value; const done = response();
    await controller.callbackGoogle({headers:{cookie:`oauthState=${state}`},query:{state,...(denied ? {error:'access_denied'} : {code:'code'})}},done);
    const url = new URL(done.location);
    assert.equal(url.pathname, '/Frontend/');
    assert.equal(url.origin, 'http://localhost:3000');
    if (denied) assert.equal(url.searchParams.get('reason'),'ACCESS_DENIED');
    else assert.ok(done.cookies.frontendRefreshToken);
  }
});
