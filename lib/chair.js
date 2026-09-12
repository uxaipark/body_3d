/** One shared, metre-scale chair envelope for rendering and contact constraints. */
export const chair={width:.43,depth:.36,centerZ:-.37,seatTop:.43,seatThickness:.026,clearance:.003};
export function aboveSeat(x,z){return Math.abs(x)<=chair.width/2+.003&&Math.abs(z-chair.centerZ)<=chair.depth/2+.003;}
