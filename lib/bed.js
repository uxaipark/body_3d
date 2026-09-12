/** Shared support surface in metres; small deflections are a visual approximation. */
export const bed={width:1.04,depth:2.02,centerZ:-1.20,top:.43,thickness:.12,clearance:.004};
export function aboveBed(x,z){return Math.abs(x)<=bed.width/2+.003&&Math.abs(z-bed.centerZ)<=bed.depth/2+.003;}
export function bedSurface(x,z,load){
 const g=(cx,cz,wx,wz)=>Math.exp(-(((x-cx)/wx)**2+((z-cz)/wz)**2));
 return bed.top+.048*g(0,-1.96,.24,.20)-load*(.008*g(0,-1.20,.25,.25)+.005*g(0,-1.65,.32,.20)+.002*g(0,-.40,.23,.14));
}
export const bedShader=`uniform float uBedLoad;
float bedG(vec2 p,vec2 c,vec2 w){vec2 d=(p-c)/w;return exp(-dot(d,d));}
float bedTop(vec2 p){return .43+.048*bedG(p,vec2(0.,-1.96),vec2(.24,.20))-uBedLoad*(.008*bedG(p,vec2(0.,-1.20),vec2(.25,.25))+.005*bedG(p,vec2(0.,-1.65),vec2(.32,.20))+.002*bedG(p,vec2(0.,-.40),vec2(.23,.14)));}
`;

/** Place the long bed edge immediately behind the standing bind position.
 * Authored bed coordinates remain local, shared by contact and mattress shape. */
export const bedPlacement={angle:Math.PI/2,x:1.2,z:-.805};
export function bedToWorld(x,z,anchor={x:0,z:0}){return [z+bedPlacement.x+anchor.x,-x+bedPlacement.z+anchor.z];}
export function worldToBed(x,z,anchor={x:0,z:0}){return [-z+bedPlacement.z+anchor.z,x-bedPlacement.x-anchor.x];}
