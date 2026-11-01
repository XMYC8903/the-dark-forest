const databaseName='dark-forest-replay-resume';
const storeName='archives';

function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('无法打开回放缓存'));
  });
}

async function archiveOperation(mode,action){
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode),request=action(transaction.objectStore(storeName));
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||new Error('回放缓存操作已取消'));
  });}finally{db.close();}
}

export const saveResumeArchive=(id,archive)=>archiveOperation('readwrite',store=>store.put(archive,id));
export const loadResumeArchive=id=>archiveOperation('readonly',store=>store.get(id));
export const deleteResumeArchive=id=>archiveOperation('readwrite',store=>store.delete(id));
