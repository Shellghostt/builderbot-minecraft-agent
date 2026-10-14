// 1.21.4 entity metadata (minecraft-data): mob_flags 15, swell_dir 16, is_powered 17, is_ignited 18.
// swell_dir is -1 idle and 1 while the fuse is running. Confirm the index on this server before trusting it.
export function creeperSwell(entity){
 const md=entity&&entity.metadata;
 if(!md)return {fusing:false,powered:false,known:false,swell:null,keep:7};
 const swell=md[16];
 const powered=md[17]===true||md[17]===1;
 const ignited=md[18]===true||md[18]===1;
 const known=swell!==undefined&&swell!==null;
 return {fusing:swell===1||ignited,powered,known,swell:known?swell:null,keep:powered?14:7};
}
