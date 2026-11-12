const role=new URLSearchParams(location.search).get('mirror-role')??'putz';
export const previewUser={_id:'preview-user',_creationTime:0,name:'Local preview',email:'preview@example.invalid',affiliation:role==='other'?'NONE':'PUTZ',isAdmin:role==='admin'};
export function useAuthStatus(){return {user:role==='signed-out'?null:previewUser,isAuthLoading:role==='loading',isUserReady:!['signed-out','loading'].includes(role)};}
