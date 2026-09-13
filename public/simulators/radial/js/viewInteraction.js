// Central 36% of the viewport is a screen-Z roll handle; the surrounding
// area remains a conventional orbit control. Patch dragging has priority.
export function isCenterDrag(x,y,rect){return Math.abs(x-rect.left-rect.width/2)<rect.width*.18&&Math.abs(y-rect.top-rect.height/2)<rect.height*.18;}
