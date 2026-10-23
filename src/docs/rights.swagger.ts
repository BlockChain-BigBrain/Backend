const json = (schema: object) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const amount = { oneOf: [{ type: "string", pattern: "^\\d+(\\.\\d+)?$" }, { type: "number" }], description: "Decimal. KRW 0자리, USD 2자리, ETH/MATIC 18자리. 문자열 권장." };
const source = { type: "string", enum: ["UNCONFIGURED", "MOCK", "REAL"] };
const currencies = { type: "string", enum: ["KRW", "USD", "ETH", "MATIC"] };
const type = { type: "string", enum: ["PERSONAL", "COMMERCIAL"] };
const optional = [{}, { "access-token": [] }], authenticated = [{ "access-token": [] }];
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const errorResponses = Object.fromEntries([400,401,403,404,409,500,502,503].map(code=>[String(code),{description: ({400:"입력 오류",401:"인증 필요",403:"권한 없음",404:"레코드 없음",409:"현재 상태와 충돌/중복",500:"서버 오류",502:"외부 결과 검증 실패",503:"외부 Provider 미설정"} as Record<number,string>)[code],content:json(ref("TrackError"))}]));
const paging = [
  {name:"page",in:"query",schema:{type:"integer",minimum:1,maximum:10000,default:1}},
  {name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:100,default:20}},
];
export const rightsSchemas = {
  VerificationResult: {type:"object",properties:{id:{type:"integer"},trackId:{type:"integer"},status:{type:"string",enum:["PENDING","VERIFIED","REJECTED"]},source:{type:"string",enum:["UNCONFIGURED","MOCK","AI"]},duplicate:{type:"boolean",nullable:true},riskScore:{type:"string",nullable:true},riskStatus:{type:"string",nullable:true,enum:["PASS","WARN","HOLD"]},modelVersion:{type:"string",nullable:true},errorCode:{type:"string",nullable:true},verifiedAt:{type:"string",format:"date-time",nullable:true},similarityResults:{type:"array",maxItems:3,items:{type:"object",properties:{comparedTrackId:{type:"integer",nullable:true},comparedUrl:{type:"string",nullable:true},score:{type:"string"}}}}}},
  Metadata: {type:"object",properties:{schemaVersion:{type:"string",example:"1.0"},title:{type:"string"},audioHash:{type:"string"},creator:{type:"string"},contributors:{type:"array",items:object({wallet:{type:"string"},percentage:{type:"string"}})},verification:{type:"object",properties:{source:{type:"string",enum:["AI","MOCK","UNCONFIGURED"]},duplicate:{type:"boolean"},riskScore:{type:"number",minimum:0,maximum:1},status:{type:"string",enum:["PASS","WARN","HOLD"]},modelVersion:{type:"string"}}},prompt:{type:"string",nullable:true},workLog:{type:"string",nullable:true},disclosure:{type:"object"}}},
  MetadataSnapshot:{type:"object",properties:{id:{type:"integer"},version:{type:"integer"},hash:{type:"string"},document:ref("Metadata"),status:{type:"string",enum:["PREPARED","UPLOADED","FAILED"]},metadataCid:{type:"string",nullable:true},audioCid:{type:"string",nullable:true},localReady:{type:"boolean"},errorCode:{type:"string",nullable:true}}},
  RegistrationPayload:{type:"object",properties:{ready:{type:"boolean"},missing:{type:"array",items:{type:"string"}},typedData:{type:"object",nullable:true,description:"EIP-712 domain/types/value. 실제 CID·AI 결과·지분 확정·서명 설정 필요"},signature:{type:"string",nullable:true},stage:{type:"string",enum:["PREPARATION","SIGNED_PREPARATION"]},sent:{type:"boolean",example:false},request:{type:"object",properties:{id:{type:"integer"},nonce:{type:"string"},deadline:{type:"string",format:"date-time"},status:{type:"string"},source}}}},
  MarketplaceListing:{type:"object",properties:{id:{type:"integer"},trackId:{type:"integer"},sellerId:{type:"integer"},price:{type:"string"},currency:currencies,status:{type:"string",enum:["PREPARING","ACTIVE","INACTIVE"]},licenseType:type,warning:{type:"boolean"},purchasable:{type:"boolean"},preparation:{type:"boolean"},track:{type:"object",properties:{id:{type:"integer"},title:{type:"string"},creator:{type:"object"},verification:{type:"object"}}}}},
  PurchaseRequest:{type:"object",properties:{id:{type:"integer",description:"구매 요청 ID. 라이선스 ID와 구분"},licenseId:{type:"integer",nullable:true},trackId:{type:"integer"},buyerId:{type:"integer"},price:{type:"string"},currency:currencies,licenseType:type,status:{type:"string",enum:["PENDING_PAYMENT","PENDING_MINT","COMPLETED","SIMULATED","FAILED","CANCELLED"]},source,preparation:{type:"boolean"},ownershipConfirmed:{type:"boolean"},simulated:{type:"boolean"},license:ref("IssuedLicense"),transaction:ref("RightsTransaction")}},
  IssuedLicense:{type:"object",properties:{id:{type:"integer"},licenseStatus:{type:"string",enum:["PENDING_PAYMENT","PENDING_MINT","COMPLETED","FAILED","CANCELLED"]},source,ownershipConfirmed:{type:"boolean"},tokenId:{type:"string",nullable:true},purchaseTxHash:{type:"string",nullable:true},issuedAt:{type:"string",format:"date-time",nullable:true}}},
  RightsTransaction:{type:"object",properties:{id:{type:"integer"},amount:{type:"string"},currency:currencies,source,status:{type:"string",enum:["PENDING","COMPLETED","FAILED"]},confirmedAt:{type:"string",format:"date-time",nullable:true},txHash:{type:"string",nullable:true},paymentReference:{type:"string",nullable:true}}},
  RevenueSummary:{type:"object",properties:{withdrawalSupported:{type:"boolean",example:false},allocationCount:{type:"integer"},balances:{type:"array",items:object({currency:currencies,estimated:{type:"string"},confirmed:{type:"string"},available:{type:"string",example:"0"}})},note:{type:"string"}}},
  WithdrawalRequest:{type:"object",properties:{id:{type:"integer"},status:{type:"string",example:"PREPARING"},amount:{type:"string"},currency:currencies,txHash:{type:"string",nullable:true},supported:{type:"boolean",example:false}}},
};
interface Operation {
  path:string; method:"get"|"post"|"patch"|"delete"; tag:string; summary:string;
  description?:string; public?:boolean; status?:number; response?:object; body?:object; parameters?:object[];
}
const contribution = {userId:{type:"integer",minimum:1},role:{type:"string",enum:["PROMPT","EDIT","COMPOSER","VOCAL","PRODUCER","OTHER"]},percentage:amount};
const page = (name:string) => object({items:{type:"array",items:ref(name)},total:{type:"integer"},page:{type:"integer"},limit:{type:"integer"}});
const operations:Operation[] = [
  {path:"/api/users/me/wallet",method:"get",tag:"Blockchain",summary:"본인의 지갑 등록 상태"},
  {path:"/api/users/me/wallet/challenge",method:"post",tag:"Blockchain",summary:"지갑 소유권 서명 챌린지",status:201,body:object({walletAddress:{type:"string"}},["walletAddress"]),description:"5분 만료, 사용자/주소/서비스에 묶인 message. 지갑으로 EIP-191 signMessage 서명하며 외부 RPC 호출 없음."},
  {path:"/api/users/me/wallet",method:"post",tag:"Blockchain",summary:"서명 검증 후 지갑 등록",body:object({signature:{type:"string"}},["signature"]),description:"챌린지 일회용. 등록된 주소를 임의 생성하지 않음. 기여도 확정/등록 이후 지갑 변경 금지."},
  {path:"/api/tracks/{id}/contributors",method:"get",tag:"Contributions",summary:"역할별 기여와 확정 상태",public:true},
  {path:"/api/tracks/{id}/contributors",method:"post",tag:"Contributions",summary:"소유자의 기여자 등록",status:201,body:object(contribution,["userId","role","percentage"]),description:"비율 (0,100], 최대 2자리. 합계 ≤100. 동일 사용자의 다른 역할은 허용."},
  {path:"/api/tracks/{id}/contributors/{contributionId}",method:"patch",tag:"Contributions",summary:"역할/비율 수정",body:object({role:contribution.role,percentage:amount})},
  {path:"/api/tracks/{id}/contributors/{contributionId}",method:"delete",tag:"Contributions",summary:"기여자 삭제",status:204},
  {path:"/api/tracks/{id}/contributors/finalize",method:"post",tag:"Contributions",summary:"지분 정확히 100%로 확정",description:"기존 사용자 지갑 필수. 사용자별 역할 지분 합산. 확정/등록 이후 변경 불가."},
  {path:"/api/tracks/{id}/verify",method:"post",tag:"Verification",summary:"AI 검증 요청/결과 저장",status:202,response:ref("VerificationResult"),description:"동시 PENDING 중복 거부. 기본 미설정 Provider는 REJECTED/AI_NOT_CONFIGURED 기록. 명시적 mock 모드만 고정 fixture 분석. VERIFIED + MOCK은 실제 분석 완료가 아님."},
  {path:"/api/tracks/{id}/reverify",method:"post",tag:"Verification",summary:"재검증",status:202,response:ref("VerificationResult"),description:"등록 중 요청은 거부. 공개 판매는 검증 시작부터 중단하며 등록 후 재검증 결과가 기존 Metadata와 다르면 재판매되지 않음."},
  {path:"/api/tracks/{id}/verification",method:"get",tag:"Verification",summary:"최신 판정과 Top-3",public:true,response:ref("VerificationResult")},
  {path:"/api/tracks/{id}/verifications",method:"get",tag:"Verification",summary:"소유자의 검증 이력",response:{type:"array",items:ref("VerificationResult")}},
  {path:"/api/tracks/{id}/metadata",method:"get",tag:"Metadata",summary:"소유자 Metadata 미리보기",response:ref("Metadata"),description:"해시·확정 기여도·지갑·완료 판정 필요. 기본 prompt/workLog 미포함."},
  {path:"/api/tracks/{id}/metadata/prepare",method:"post",tag:"Metadata",summary:"버전/해시와 로컬 JSON 준비",status:201,response:ref("MetadataSnapshot"),body:object({publishPrompt:{type:"boolean",default:false},publishWorkLog:{type:"boolean",default:false},acceptPublicDisclosure:{type:"boolean",default:false}}),description:"작업 로그 포함 시 공개 동의 필수. 동일 내용은 최신 스냅샷 재사용. 실제 업로드 없으면 CID null."},
  {path:"/api/tracks/{id}/ipfs",method:"get",tag:"Metadata",summary:"IPFS 준비/업로드 상태"},
  {path:"/api/tracks/{id}/register",method:"post",tag:"Blockchain",summary:"등록 요청과 EIP-712 준비",status:202,response:ref("RegistrationPayload"),description:"현재 트랜잭션 전송 없음. 실제 AI/CID/지갑/서명 설정이 없으면 ready=false와 선행 조건을 반환. REGISTERED는 영수증 검증 후만 허용."},
  {path:"/api/tracks/{id}/registration-payload",method:"get",tag:"Blockchain",summary:"만료 검사 후 EIP-712 payload",response:ref("RegistrationPayload")},
  {path:"/api/tracks/{id}/blockchain",method:"get",tag:"Blockchain",summary:"등록 상태와 영수증 정보"},
  {path:"/api/tracks/{id}/register/confirm",method:"post",tag:"Blockchain",summary:"Provider로 등록 영수증 확인",body:object({txHash:{type:"string",pattern:"^0x[a-fA-F0-9]{64}$"}},["txHash"]),description:"클라이언트 해시는 증명이 아님. ABI/Provider 미설정 시 503. chain/contract/nonce/digest/registrant/confirmation을 검증."},
  {path:"/api/tracks/{id}/register/cancel",method:"post",tag:"Blockchain",summary:"미서명 준비 요청 취소",description:"발급된 서명은 온체인 nonce 취소 기능이 없으므로 만료 전 취소할 수 없음."},
  {path:"/api/market/tracks",method:"post",tag:"Marketplace",summary:"판매/판매 준비 등록",status:201,response:ref("MarketplaceListing"),body:object({trackId:{type:"integer"},price:amount,currency:currencies,status:{type:"string",enum:["PREPARING","ACTIVE"],default:"PREPARING"},licenseType:type},["trackId","price","currency"]),description:"소유자만 가능. HOLD/중복/미검증 거부. Mock은 PREPARING만 가능, 실제 등록만 ACTIVE."},
  {path:"/api/market/tracks",method:"get",tag:"Marketplace",summary:"공개 상품 검색/가격 필터/페이지네이션",public:true,response:page("MarketplaceListing"),parameters:[...paging,{name:"search",in:"query",schema:{type:"string",maxLength:191}},{name:"currency",in:"query",schema:currencies},{name:"minPrice",in:"query",schema:{type:"string"}},{name:"maxPrice",in:"query",schema:{type:"string"}},{name:"sort",in:"query",schema:{type:"string",enum:["createdAt","price"],default:"createdAt"}},{name:"order",in:"query",schema:{type:"string",enum:["asc","desc"],default:"desc"}},{name:"scope",in:"query",schema:{type:"string",enum:["public","mine"],default:"public"}}],description:"가격 범위/가격순 정렬은 currency 필수. scope=mine은 로그인 필수이며 준비 상품 포함."},
  {path:"/api/market/tracks/{id}",method:"get",tag:"Marketplace",summary:"판매 등록 상세",public:true,response:ref("MarketplaceListing"),description:"id는 listing ID. 준비/중단 상품은 소유자만 조회."},
  {path:"/api/market/tracks/{id}",method:"patch",tag:"Marketplace",summary:"가격/통화/상품 상태 변경",response:ref("MarketplaceListing"),body:object({price:amount,currency:currencies,status:{type:"string",enum:["PREPARING","ACTIVE","INACTIVE"]},licenseType:type})},
  {path:"/api/market/tracks/{id}",method:"delete",tag:"Marketplace",summary:"판매 중단(이력 유지)",status:204},
  {path:"/api/licenses/purchase",method:"post",tag:"Licenses",summary:"라이선스 구매 요청 생성",status:201,response:ref("PurchaseRequest"),body:object({trackId:{type:"integer"},licenseType:type,amount,currency:currencies,preparation:{type:"boolean",default:false},idempotencyKey:{type:"string",maxLength:100,pattern:"^[A-Za-z0-9:_-]+$"}},["trackId","licenseType"]),parameters:[{name:"Idempotency-Key",in:"header",schema:{type:"string",maxLength:100}}],description:"가격은 서버 판매 정보로 결정하며 제공 금액과 비교. preparation=true는 준비 상품 요청이며 실제 발급 불가. 응답 id는 구매 요청 ID, 발급 라이선스는 licenseId."},
  {path:"/api/licenses/requests/{id}",method:"get",tag:"Licenses",summary:"구매 요청 상태",response:ref("PurchaseRequest")},
  {path:"/api/licenses/{id}/status",method:"get",tag:"Licenses",summary:"구매 요청 상태(호환 경로)",response:ref("PurchaseRequest"),description:"id는 POST purchase의 구매 요청 ID."},
  {path:"/api/licenses/requests/{id}/cancel",method:"post",tag:"Licenses",summary:"미결제 요청 취소",response:ref("PurchaseRequest")},
  {path:"/api/licenses/requests/{id}/reconcile",method:"post",tag:"Licenses",summary:"Provider의 결제/발급 결과 대조",response:ref("PurchaseRequest"),description:"클라이언트가 성공 결과를 제출할 수 없음. 기본 Provider 503. mock 결과는 SIMULATED, 라이선스 PENDING_MINT/MOCK, 실제 소유권 false."},
  {path:"/api/users/me/licenses",method:"get",tag:"Licenses",summary:"보유/발급 대기 라이선스",response:page("IssuedLicense"),parameters:paging},
  {path:"/api/licenses/{id}",method:"get",tag:"Licenses",summary:"본인의 발급 라이선스 상세",response:ref("IssuedLicense"),description:"id는 licenseId 또는 보유 목록의 id."},
  {path:"/api/users/me/transactions",method:"get",tag:"Revenue",summary:"본인 거래 내역",response:page("RightsTransaction"),parameters:paging},
  {path:"/api/transactions/{id}",method:"get",tag:"Revenue",summary:"구매자/수익 수령자의 거래 상세",response:ref("RightsTransaction")},
  {path:"/api/users/me/revenue",method:"get",tag:"Revenue",summary:"통화별 예상/확정/출금 가능 수익",response:ref("RevenueSummary"),description:"Mock은 예상 수익만 반영. confirmed도 RevenueSplitter 잔액 검증 없이 출금 가능 금액으로 취급하지 않음."},
  {path:"/api/users/me/revenue/history",method:"get",tag:"Revenue",summary:"본인 수익 배분 이력",parameters:paging},
  {path:"/api/revenue/withdraw",method:"post",tag:"Revenue",summary:"출금 준비 요청",status:202,response:ref("WithdrawalRequest"),body:object({amount,currency:currencies,idempotencyKey:{type:"string",maxLength:100}},["amount","currency"]),description:"PREPARING만 기록. 실제 출금/예약/가짜 txHash를 생성하지 않으며 supported=false."},
];
export const rightsPaths: Record<string, Record<string, object>> = {};
for (const operation of operations) {
  const parameters = [...Array.from(operation.path.matchAll(/\{([^}]+)\}/g), match => ({name:match[1],in:"path",required:true,schema:{type:"integer",minimum:1,maximum:2147483647}})), ...(operation.parameters ?? [])];
  rightsPaths[operation.path] ??= {};
  const status = operation.status ?? 200;
  rightsPaths[operation.path][operation.method] = {
    tags:[operation.tag],summary:operation.summary,description:operation.description,security:operation.public?optional:authenticated,
    ...(parameters.length?{parameters}:{}),...(operation.body?{requestBody:{required:true,content:json(operation.body)}}:{}),
    responses:{...errorResponses,[String(status)]:{description:"요청 처리",...(status===204?{}:{content:json(operation.response ?? {type:"object"})})}},
  };
}


/**
 * @openapi
 * /api/tracks/{id}/metadata/upload:
 *   post:
 *     tags: [Rights]
 *     summary: Upload prepared public metadata and audio to configured IPFS and verify both content hashes
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       '200': { description: Verified IPFS CIDs stored in metadata snapshot }
 *       '401': { description: Authentication required }
 *       '403': { description: Track owner required }
 *       '409': { description: Metadata stale or registration already pending/complete }
 *       '502': { description: IPFS upload or content verification failed }
 *       '503': { description: IPFS provider not configured }
 */
