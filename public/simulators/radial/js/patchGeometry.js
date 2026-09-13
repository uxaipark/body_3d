export function rotatePatchPoint(lateral, along, degrees=0) {
 const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 return {lateral:lateral*c-along*s,along:lateral*s+along*c};
}
export function patchAlongHalf(width,length,degrees=0){const a=degrees*Math.PI/180;return (Math.abs(Math.sin(a))*width+Math.abs(Math.cos(a))*length)/2;}
export function normalizePatchAngle(degrees){return Number.isFinite(degrees)?((degrees+180)%360+360)%360-180:0;}
export function clipPatchPath(points,halfWidth,halfLength){
 const segments=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.lateral_mm-a.lateral_mm,dy=b.along_mm-a.along_mm;let lo=0,hi=1,valid=true;
  const p=[-dx,dx,-dy,dy],q=[a.lateral_mm+halfWidth,halfWidth-a.lateral_mm,a.along_mm+halfLength,halfLength-a.along_mm];
  for(let k=0;k<4;k++){if(Math.abs(p[k])<1e-12){if(q[k]<0)valid=false;}else{const t=q[k]/p[k];if(p[k]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}}
  if(valid&&lo<=hi)for(const t of [lo,hi])segments.push({lateral_mm:a.lateral_mm+dx*t,along_mm:a.along_mm+dy*t});
 }return segments;
}

// Millimetre contour map built once from actual skin triangles. Each section is
// parameterized by arc length, so crossing the wrist edge continues around the
// circumference instead of extending the planar lateral coordinate into air.
export function buildSkinWrap(position,index,{minAlong=-110,maxAlong=8,step=3,samples=192}={}){
 const rings=[],count=index?index.length:position.length/3;
 for(let along=minAlong;along<=maxAlong+1e-6;along+=step){
  const x=(55+along)/1000,segments=[];
  for(let i=0;i<count;i+=3){const points=[];
   for(let e=0;e<3;e++){
    const a=(index?index[i+e]:i+e)*3,b=(index?index[i+(e+1)%3]:i+(e+1)%3)*3,dx=position[b]-position[a];
    if(Math.abs(dx)<1e-12)continue;const t=(x-position[a])/dx;
    if(t>=0&&t<1)points.push([1000*(position[a+1]+t*(position[b+1]-position[a+1])),1000*(position[a+2]+t*(position[b+2]-position[a+2]))]);
   }if(points.length===2)segments.push(points);
  }
  if(segments.length<3)continue;
  const ys=segments.flatMap(s=>s.map(p=>p[0])),zs=segments.flatMap(s=>s.map(p=>p[1]));
  const cy=(Math.min(...ys)+Math.max(...ys))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,points=[];
  for(let j=0;j<samples;j++){
   const angle=j/samples*Math.PI*2,dy=Math.cos(angle),dz=Math.sin(angle);let radius=0;
   for(const [a,b] of segments){const ay=a[0]-cy,az=a[1]-cz,ey=b[0]-a[0],ez=b[1]-a[1],den=dy*ez-dz*ey;
    if(Math.abs(den)<1e-10)continue;const r=(ay*ez-az*ey)/den,u=(ay*dz-az*dy)/den;
    if(r>radius&&u>=-1e-8&&u<=1+1e-8)radius=r;
   }
   if(!radius)throw new Error(`Open skin contour at ${along} mm`);
   points.push([cy+dy*radius,cz+dz*radius]);
  }
  const arc=[0];for(let j=1;j<=samples;j++){const a=points[j-1],b=points[j%samples];arc.push(arc[j-1]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
  rings.push({along,points,arc,cy});
 }
 if(rings.length<2)throw new Error('Skin wrap requires at least two closed sections');
 return createSkinWrap(rings);
}
export function createSkinWrap(rings){
 function onRing(r,lateral,offset){
  const {points,arc,cy}=r,n=points.length;let anchor=0,bestY=-Infinity,bestDistance=Infinity;
  if(r.anchorLateral===lateral)anchor=r.anchor;
  else {for(let j=0;j<n;j++){const a=points[j],b=points[(j+1)%n],d=b[1]-a[1];
   const t=Math.abs(d)<1e-12?0:Math.max(0,Math.min(1,(lateral-a[1])/d));
   const y=a[0]+t*(b[0]-a[0]),z=a[1]+t*d,distance=Math.abs(z-lateral);
   if(y<cy-1e-6)continue;
   if(distance<bestDistance-1e-6||(Math.abs(distance-bestDistance)<1e-6&&y>bestY)){bestDistance=distance;bestY=y;anchor=arc[j]+t*(arc[j+1]-arc[j]);}
  }r.anchorLateral=lateral;r.anchor=anchor;}
  const s=((anchor+offset)%arc[n]+arc[n])%arc[n];let lo=0,hi=n;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(arc[mid]<=s)lo=mid;else hi=mid;}
  const a=points[lo],b=points[(lo+1)%n],t=(s-arc[lo])/(arc[lo+1]-arc[lo]),dy=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dy,dz);
  return {y:a[0]+t*dy,z:a[1]+t*dz,ny:dz/len,nz:-dy/len};
 }
 return {rings,arcBetween(from,to,along){
  let i=0;while(i<rings.length-2&&rings[i+1].along<along)i++;
  const a=rings[i],b=rings[i+1],t=Math.max(0,Math.min(1,(along-a.along)/(b.along-a.along)));
  const delta=r=>{onRing(r,from,0);const start=r.anchor;onRing(r,to,0);const length=r.arc.at(-1);return ((r.anchor-start+length/2)%length+length)%length-length/2;};
  const x=delta(a),y=delta(b);return x+(y-x)*t;
 },sample(lateral,along,offset=0){
  let i=0;while(i<rings.length-2&&rings[i+1].along<along)i++;
  const a=rings[i],b=rings[i+1],t=Math.max(0,Math.min(1,(along-a.along)/(b.along-a.along))),p=onRing(a,lateral,offset),q=onRing(b,lateral,offset);
  const y=p.y+(q.y-p.y)*t,z=p.z+(q.z-p.z)*t,ny=p.ny+(q.ny-p.ny)*t,nz=p.nz+(q.nz-p.nz)*t;
  const nx=-((q.y-p.y)*ny+(q.z-p.z)*nz)/(b.along-a.along),len=Math.hypot(nx,ny,nz);
  return {y,z,nx:nx/len,ny:ny/len,nz:nz/len};
 }};
}
