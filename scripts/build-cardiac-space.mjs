import fs from'node:fs';import *as T from'three';
const s=JSON.parse(fs.readFileSync('/tmp/soma-cardiorespiratory-check.json','utf8'));
const g=new T.IcosahedronGeometry(1,1),a=g.getAttribute('position'),unique=new Map();for(let i=0;i<a.count;i++){const n=new T.Vector3().fromBufferAttribute(a,i).normalize();unique.set(n.toArray().map(v=>v.toFixed(5)).join(','),n);}
const planes=[...unique.values()].map(n=>{let support=-Infinity;for(const m of s.hearts)for(const phase of m.phases)for(const p of phase)support=Math.max(support,n.x*p[0]+n.y*p[1]+n.z*p[2]+Math.max(0,-n.y*.002));return [...n.toArray(),support+.003];});
fs.writeFileSync('lib/cardiac-space-data.js',`// Swept cardiac envelope: 20 contraction phases + 2 mm respiratory descent.\nexport const cardiacSpacePlanes=${JSON.stringify(planes)};\n`);console.log('Cardiac clearance envelope:',planes.length,'planes');
