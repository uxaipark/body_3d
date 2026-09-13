// Pure layer configuration, safe to import during server rendering.
export type Layer='skin'|'dermis'|'adipose'|'cardiovascular'|'visceral'|'nervous'|'skeleton'|'muscular';
export type Layers=Record<Layer,number>;
export const initialLayers:Layers={skin:0,dermis:0,adipose:0,cardiovascular:100,visceral:80,nervous:65,skeleton:13,muscular:9};
