import { S3Client, HeadBucketCommand, ListBucketsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
const env=readFileSync(".env","utf8");const g=(k)=>(env.match(new RegExp("^"+k+"=(.*)$","m"))||[])[1]||"";
const c=new S3Client({region:g("S3_REGION"),endpoint:g("S3_ENDPOINT"),forcePathStyle:true,credentials:{accessKeyId:g("S3_ACCESS_KEY"),secretAccessKey:g("S3_SECRET_KEY")}});
try{ await c.send(new HeadBucketCommand({Bucket:g("S3_BUCKET")})); console.log("BUCKET 'bitpix': EXISTE e acessível ✓"); }
catch(e){ console.log("HeadBucket falhou:", e.name||"", e.$metadata?.httpStatusCode||"", e.message?.split("\n")[0]||"");
  try{ const r=await c.send(new ListBucketsCommand({})); console.log("Buckets disponíveis:", (r.Buckets||[]).map(b=>b.Name).join(", ")||"(nenhum)"); }catch(e2){ console.log("ListBuckets falhou:", e2.name, e2.message?.split("\n")[0]); } }
