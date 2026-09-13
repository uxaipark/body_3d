// Spatial tethering, not a fitted material/FEM model. Distances are millimetres.
// Keep the complete atlas vessel, with C2 transitions to fixed forearm/hand ends.
const smooth=t=>t*t*t*(10+t*(-15+6*t));
const slope=t=>30*t*t*(1-t)*(1-t);
export function arteryTether(along){
 if(along<=-125||along>=20)return {weight:0,derivative:0};
 if(along<-105){const t=(along+125)/20;return {weight:smooth(t),derivative:slope(t)/20};}
 if(along<=0)return {weight:1,derivative:0};
 const t=along/20;return {weight:1-smooth(t),derivative:-slope(t)/20};
}
