import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { db, isBrowser } from "@/lib/db";
import type { Role, User } from "./types";
type CachedUser=User&{email?:string;mustChangePassword?:boolean;disabled?:boolean};
const OFFLINE_USER_KEY="auth.offlineUser";
interface AuthState{user:CachedUser|null;hydrated:boolean;signIn:(username:string,password:string)=>Promise<User>;signOut:()=>Promise<void>;refreshProfile:()=>Promise<void>;}
async function saveCachedUser(user:CachedUser|null){if(!isBrowser())return;try{if(user)await db().meta.put({key:OFFLINE_USER_KEY,value:user});else await db().meta.delete(OFFLINE_USER_KEY);}catch{}}
async function readCachedUser(userId?:string):Promise<CachedUser|null>{if(!isBrowser())return null;try{const row=await db().meta.get(OFFLINE_USER_KEY);const u=row?.value as CachedUser|undefined;return u&&!u.disabled&&(!userId||u.id===userId)?u:null;}catch{return null;}}
async function loadUserFromSession(userId:string,email:string|undefined):Promise<CachedUser>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const [p,r]=await Promise.race([
   Promise.all([
    supabase.from("profiles").select("id, full_name, username, must_change_password, disabled").eq("id",userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id",userId)
   ]),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Le profil n'a pas répondu assez vite")),8_000);})
  ]);
  if(p.error)throw p.error;if(r.error)throw r.error;
  const profile=p.data,roles=(r.data??[]).map(x=>x.role as Role);
  return{id:userId,fullName:profile?.full_name??email?.split("@")[0]??"Utilisateur",username:profile?.username??email?.split("@")[0]??"user",role:roles.includes("admin")?"admin":roles.includes("agent")?"agent":"viewer",email,mustChangePassword:profile?.must_change_password??false,disabled:profile?.disabled??false,createdAt:Date.now()};
 } finally {if(timer)clearTimeout(timer);}
}
async function hydrateSession(id:string,email?:string){if(!navigator.onLine){useAuth.setState({user:await readCachedUser(id),hydrated:true});return;}try{const u=await loadUserFromSession(id,email);if(u.disabled){await saveCachedUser(null);useAuth.setState({user:null,hydrated:true});return;}await saveCachedUser(u);useAuth.setState({user:u,hydrated:true});}catch{useAuth.setState({user:await readCachedUser(id),hydrated:true});}}
export const useAuth=create<AuthState>()((set)=>({user:null,hydrated:false,
 signIn:async(identifier,password)=>{const email=identifier.trim();if(!email.includes("@"))throw new Error("Connectez-vous avec votre adresse e-mail.");const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error||!data.user){const code=String(error?.code??"");const status=Number(error?.status??0);if(code==="invalid_credentials"||status===400)throw new Error("Adresse e-mail ou mot de passe incorrect.");if(code==="email_not_confirmed")throw new Error("Ce compte doit être validé avant de pouvoir se connecter.");if(code==="user_banned"||status===403)throw new Error("L’accès à ce compte est temporairement indisponible. Contactez l’administrateur.");console.error("[auth] Sign-in failed", {code,status});throw new Error("Connexion momentanément impossible. Veuillez réessayer dans quelques instants.");}const u=await loadUserFromSession(data.user.id,data.user.email??email);if(u.disabled){await supabase.auth.signOut();throw new Error("Ce compte est désactivé. Contactez l'administrateur.");}await saveCachedUser(u);set({user:u,hydrated:true});return u;},
 signOut:async()=>{await saveCachedUser(null);await supabase.auth.signOut().catch(()=>{});set({user:null,hydrated:true});},
 refreshProfile:async()=>{const {data}=await supabase.auth.getSession();if(!data.session?.user){set({user:null,hydrated:true});return;}await hydrateSession(data.session.user.id,data.session.user.email);}
}));
if(typeof window!=="undefined"){
 void supabase.auth.getSession().then(async({data,error})=>{if(data.session?.user)await hydrateSession(data.session.user.id,data.session.user.email);else if(!navigator.onLine||error)useAuth.setState({user:await readCachedUser(),hydrated:true});else{await saveCachedUser(null);useAuth.setState({hydrated:true});}}).catch(async()=>useAuth.setState({user:await readCachedUser(),hydrated:true}));
 supabase.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"){void saveCachedUser(null);useAuth.setState({user:null,hydrated:true});return;}if(["SIGNED_IN","USER_UPDATED","TOKEN_REFRESHED"].includes(event)&&session?.user)setTimeout(()=>{void hydrateSession(session.user.id,session.user.email);},0);});
 window.addEventListener("online",()=>{void supabase.auth.getSession().then(({data})=>{if(data.session?.user)return hydrateSession(data.session.user.id,data.session.user.email);}).catch(()=>{});});
}
export const hasRole = (user: { role: Role } | null, ...roles: Role[]) => !!user && roles.includes(user.role);
