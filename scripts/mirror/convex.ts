import { getFunctionName } from 'convex/server';
const empty:unknown[]=[];
const players={alive:[],dead:[]};
const settings={djName:'Local preview',djColor:'#f76b15',rekordboxFolder:''};
function fixtureQuery(reference:never,args?:unknown):unknown{
  if(args==='skip')return undefined;
  const name=getFunctionName(reference);
  if(name==='assassins:getPlayers')return players;
  if(name==='djs:myDjSettings')return settings;
  return empty;
}
export function useQuery(reference:never,args?:unknown):unknown{return fixtureQuery(reference,args);}
const blocked=async()=>{throw Error('Read-only local mirror: changes to Wokenet are disabled.');};
const fixtureRefresh=async()=>null;
blocked.withOptimisticUpdate=()=>blocked;
fixtureRefresh.withOptimisticUpdate=()=>fixtureRefresh;
export function useMutation(reference:never){return getFunctionName(reference)==='locations:refetchLocations'?fixtureRefresh:blocked;}
const client={query:async(reference:never,args?:unknown)=>fixtureQuery(reference,args),mutation:blocked,action:blocked};
export function useConvex(){return client;}
export function useConvexAuth(){return {isLoading:false,isAuthenticated:true};}
