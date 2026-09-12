import {tissueBoundary,type SectionProfile} from './skin-section-model';

/** Rest-space histology illustration. Generated once, then deformed on the GPU
 * with the volumetric section; microstructures never float over moving layers. */
export function makeSectionTexture(p:SectionProfile){
 const canvas=document.createElement('canvas'),scale=2048/24,height=p.total+.16;
 canvas.width=2048;canvas.height=Math.ceil(height*scale);
 const c=canvas.getContext('2d')!;c.scale(scale,scale);c.translate(12,.08);
 let seed=90217;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const band=(a:number,b:number)=>{c.beginPath();for(let i=0;i<=240;i++){const x=-12+i*.1;i?c.lineTo(x,tissueBoundary(x,a,p)):c.moveTo(x,tissueBoundary(x,a,p));}for(let i=240;i>=0;i--){const x=-12+i*.1;c.lineTo(x,tissueBoundary(x,b,p));}c.closePath();};
 const ellipse=(x:number,y:number,rx:number,ry:number,color:string,angle=0)=>{c.beginPath();c.ellipse(x,y,rx,ry,angle,0,Math.PI*2);c.fillStyle=color;c.fill();};
 const stroke=(color:string,width:number,points:[number,number][])=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();};
 const colors=['#e6c3a7','#ba827d','#d59b9a','#b9767b','#c7a361',p.regionId==='ear'?'#c7a361':'#82717c'];
 for(let layer=0;layer<6;layer++){band(layer,layer+1);c.fillStyle=colors[layer];c.fill();}

 // Adipose lobules: irregular Voronoi territories, fibrous septa, and smaller
 // unilocular adipocytes rather than a regular row of identical yellow ovals.
 c.save();band(4,5);c.clip();
 const seeds:[number,number][]=[];
 for(let row=0;row<Math.ceil(p.fat/1.3)+1;row++)for(let col=0;col<17;col++)seeds.push([-12+col*1.55+(random()-.5)*.75,p.dermis+row*1.3+(random()-.5)*.6]);
 for(const centre of seeds){
  let polygon:[number,number][]=[[-12,p.dermis-.2],[12,p.dermis-.2],[12,p.dermis+p.fat+.2],[-12,p.dermis+p.fat+.2]];
  for(const other of seeds){
   if(other===centre||Math.hypot(other[0]-centre[0],other[1]-centre[1])>4)continue;
   const nx=other[0]-centre[0],ny=other[1]-centre[1],limit=(other[0]**2+other[1]**2-centre[0]**2-centre[1]**2)/2,next:[number,number][]=[];
   for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a[0]*nx+a[1]*ny-limit,db=b[0]*nx+b[1]*ny-limit;if(da<=0)next.push(a);if((da<0)!==(db<0)){const t=da/(da-db);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}
   polygon=next;if(!polygon.length)break;
  }
  if(polygon.length<3)continue;
  c.save();c.beginPath();polygon.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();
  const gradient=c.createRadialGradient(centre[0]-.3,centre[1]-.2,.1,centre[0],centre[1],1.6);gradient.addColorStop(0,'#ebd899');gradient.addColorStop(1,'#ba985d');c.fillStyle=gradient;c.fill();c.strokeStyle='#eed7b9';c.lineWidth=.055;c.stroke();c.clip();
  const minX=Math.min(...polygon.map(v=>v[0])),maxX=Math.max(...polygon.map(v=>v[0])),minY=Math.min(...polygon.map(v=>v[1])),maxY=Math.max(...polygon.map(v=>v[1]));
  for(let y=minY;y<maxY;y+=.14)for(let x=minX;x<maxX;x+=.15){const px=x+(random()-.5)*.07,py=y+(random()-.5)*.06,r=.055+random()*.025;c.beginPath();c.ellipse(px,py,r,r*(.75+random()*.3),random(),0,Math.PI*2);c.fillStyle=random()>.4?'#f0dfaa':'#e6ce8d';c.fill();c.strokeStyle='#b7985a88';c.lineWidth=.008;c.stroke();if(random()>.75)ellipse(px+r*.7,py+r*.35,.01,.006,'#a08065');}
  c.restore();
 }
 c.restore();

 // Wavy interwoven collagen bundles and finer elastic fibres in the dermis.
 c.save();band(3,4);c.clip();
 for(let i=0;i<480;i++){
  const x=-13+random()*26,y=p.papillary+random()*(p.dermis-p.papillary),length=.4+random()*2.2,slope=(random()-.5)*.32,points:[number,number][]=[];
  for(let j=0;j<=22;j++){const q=j/22;points.push([x+q*length,y+q*slope+Math.sin(q*13+i)*.025]);}
  stroke(i%3?'#e1b1ac88':'#8f586c55',.025+random()*.04,points);
 }
 for(let i=0;i<190;i++){const x=-12+random()*24,y=p.papillary+random()*(p.dermis-p.papillary),points:[number,number][]=[];for(let j=0;j<15;j++)points.push([x+j*.055,y+Math.sin(j*.55+i)*.025+j*.003]);stroke('#805e6966',.009,points);ellipse(x,y,.027,.009,'#775269',random()*3);}
 c.restore();

 // Superficial vascular plexus and capillary loops in dermal papillae.
 stroke('#aa5266',.026,Array.from({length:241},(_,i)=>{const x=-12+i*.1;return[x,p.papillary+.10+.025*Math.sin(x*2)] as [number,number];}));
 stroke('#648797',.023,Array.from({length:241},(_,i)=>{const x=-12+i*.1;return[x,p.dermis-.12+.045*Math.sin(x*1.4)] as [number,number];}));
 for(let i=0;i<31;i++){const x=-11.5+i*.75,apex=tissueBoundary(x,2,p)+.065;c.beginPath();c.moveTo(x-.09,p.papillary+.11);c.bezierCurveTo(x-.10,apex,x+.10,apex,x+.10,p.papillary+.10);c.strokeStyle='#a84d66';c.lineWidth=.019;c.stroke();stroke('#7b8fa5',.013,[[x+.1,p.papillary+.1],[x+.1,apex+.04]]);}

 // Basal keratinocytes and a thin cornified surface; no epidermal vessels.
 c.save();band(1,2);c.clip();
 for(let row=0;row<8;row++)for(let col=0;col<300;col++){const x=-12+col*.083+(row%2)*.035,d=.025+row*.03;ellipse(x,d,.036,.014,'#d8a8a0');ellipse(x+.005,d,.008,.004,'#8c6078');}
 c.restore();
 for(let x=-12;x<12;x+=.055)ellipse(x,tissueBoundary(x,2,p)-.014,.02,.014,'#895970');
 for(let layer=0;layer<3;layer++)stroke('#f5dcc2',.005,Array.from({length:241},(_,i)=>{const x=-12+i*.1;return [x,tissueBoundary(x,0,p)+layer*.006] as [number,number];}));

 // Eccrine gland coils and their narrow ducts. Hair/associated sebaceous
 // glands are omitted on the finger-pad and earlobe presets.
 for(const x of [-8,6.8]){
  const glandDepth=p.dermis-.22;
  for(let j=0;j<12;j++){const angle=j*2.4,r=.055+j*.012;ellipse(x+Math.cos(angle)*r,glandDepth+Math.sin(angle)*r,.055,.038,'#9c7384');ellipse(x+Math.cos(angle)*r,glandDepth+Math.sin(angle)*r,.028,.018,'#e0beb8');}
  const duct:[number,number][]=[];for(let i=0;i<70;i++){const d=glandDepth*(1-i/69);duct.push([x+Math.sin(i*.65)*.03,d]);}stroke('#996c82',.032,duct);stroke('#dcb5ae',.012,duct);
 }
 if(p.hair)for(const x of [-4.7,8.8]){
  c.save();c.translate(x,.05);c.rotate(-.17);
  c.beginPath();c.moveTo(-.07,0);c.bezierCurveTo(-.09,.4,-.19,p.dermis,-.1,p.dermis+.25);c.bezierCurveTo(.04,p.dermis+.43,.18,p.dermis+.24,.12,p.dermis);c.lineTo(.05,0);c.closePath();c.fillStyle='#754f61';c.fill();stroke('#392f35',.033,[[0,-.06],[0,p.dermis+.13]]);
  for(let i=0;i<5;i++)ellipse(.12+i*.04,.55+(i%2)*.09,.075,.065,'#d6b49a');
  stroke('#995e67',.06,[[.1,1.05],[.64,.38]]);c.restore();
 }
 // Small cutaneous nerve fascicle, distinct from the blood vessels.
 for(let i=0;i<3;i++)stroke('#ddd3a1',.022,Array.from({length:65},(_,j)=>[-10+j*.11,p.dermis+.35+i*.04+Math.sin(j*.12)*.11] as [number,number]));
 c.save();band(5,6);c.clip();for(let i=0;i<55;i++){const d=p.dermis+p.fat+i*.026;stroke(i%2?'#c4a5a2':'#a8868d',.015,[[-12,d],[12,d+.12*Math.sin(i)]]);}c.restore();
 return {canvas,height};
}
