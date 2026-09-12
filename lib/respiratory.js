/** One classification for asset fitting and runtime deformation. The pleural
 * envelope must follow the same bounded breathing pose as the lung lobes. */
export function respiratoryPart(name){
 if(/pleura/i.test(name))return 'pleura';
 return /lung|bronch/i.test(name)?'lung':null;
}
export function isRespiratoryPart(part){return part==='lung'||part==='pleura';}
