import * as THREE from 'three';
import { createWorld } from '../src/world';
import { createTractor } from '../src/tractor';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

type MeshAsset = { color:string; roughness:number; positions:number[]; normals:number[]; indices:number[] };
type EntityAsset = { name:string; transform:number[]; visible:boolean; meshes:MeshAsset[]; children:EntityAsset[] };
const scene = new THREE.Scene();
const world = createWorld(scene);
world.update(0,0);
const landscape = scene.children[0];
const tractor = createTractor(scene).group;
scene.updateMatrixWorld(true);
const split = (object:THREE.Object3D) => /^(windmill-sails|meadow-sails|bird-|wheel-|attachment|mower|seed-box|till-tooth-)/.test(object.name);
const round = (value:number) => Math.round(value * 100000) / 100000;
function exportEntity(root:THREE.Object3D, relativeTo?:THREE.Object3D):EntityAsset {
  const inverse = root.matrixWorld.clone().invert();
  const transform = relativeTo ? relativeTo.matrixWorld.clone().invert().multiply(root.matrixWorld) : root.matrixWorld;
  const result:EntityAsset = {name:root.name||'landscape',transform:transform.toArray().map(round),visible:root.visible,meshes:[],children:[]};
  const batches = new Map<string,MeshAsset>();
  function append(mesh:THREE.Mesh,matrix:THREE.Matrix4){
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material.color) return;
    const color = '#'+material.color.getHexString();
    const key = color+':'+(material.roughness??1);
    let batch = batches.get(key);
    if(!batch){batch={color,roughness:material.roughness??1,positions:[],normals:[],indices:[]};batches.set(key,batch);}
    const positions = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    if(!positions)return;
    const base=batch.positions.length/3;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const p=new THREE.Vector3(),n=new THREE.Vector3();
    for(let i=0;i<positions.count;i++){
      p.fromBufferAttribute(positions,i).applyMatrix4(matrix);batch.positions.push(round(p.x),round(p.y),round(p.z));
      if(normals)n.fromBufferAttribute(normals,i).applyNormalMatrix(normalMatrix);else n.set(0,1,0);
      batch.normals.push(round(n.x),round(n.y),round(n.z));
    }
    const indices=mesh.geometry.index;
    if(indices)for(let i=0;i<indices.count;i++)batch.indices.push(base+indices.getX(i));
    else for(let i=0;i<positions.count;i++)batch.indices.push(base+i);
  }
  function visit(object:THREE.Object3D){
    if(object!==root&&split(object)){result.children.push(exportEntity(object,root));return;}
    if(object instanceof THREE.Mesh){
      const local=inverse.clone().multiply(object.matrixWorld);
      if(object instanceof THREE.InstancedMesh){
        const instance=new THREE.Matrix4();
        for(let i=0;i<object.count;i++){object.getMatrixAt(i,instance);append(object,local.clone().multiply(instance));}
      }else append(object,local);
    }
    object.children.forEach(visit);
  }
  visit(root);result.meshes=[...batches.values()];return result;
}
const output={version:1,world:exportEntity(landscape),tractor:exportEntity(tractor),obstacles:world.obstacles};
const destination='ios/Stillfield/Resources';
await mkdir(destination,{recursive:true});
await writeFile(destination+'/FarmScene.json',JSON.stringify(output));
const iconFolder=destination+'/Assets.xcassets/AppIcon.appiconset';
await mkdir(iconFolder,{recursive:true});
await sharp('public/icon.svg').resize(1024,1024).flatten({background:'#e9edd8'}).png().toFile(iconFolder+'/AppIcon.png');
await writeFile(iconFolder+'/Contents.json',JSON.stringify({images:[{filename:'AppIcon.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}},null,2));
await writeFile(destination+'/Assets.xcassets/Contents.json',JSON.stringify({info:{author:'xcode',version:1}},null,2));
console.log(`Native artwork exported: ${(JSON.stringify(output).length/1024/1024).toFixed(1)} MB, ${world.obstacles.length} obstacles. No web runtime required.`);
