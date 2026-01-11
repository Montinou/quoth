# **Quoth Auth & Organizations Strategy**

## **Multi-Tenancy con Supabase Auth y Row Level Security (RLS)**

### **1\. Schema Overview**

Vamos a extender el esquema existente para vincular a los usuarios de auth.users (Supabase Auth) con nuestra tabla de projects (que actuará como la "Organización").

**Nuevas Tablas:**

* profiles: Datos públicos del usuario.  
* project\_members: Tabla de enlace (User \<-\> Project) con roles.  
* project\_api\_keys: Llaves para que Claude (MCP) actúe en nombre de un proyecto.

### **2\. SQL Implementation**

Ejecuta este script en Supabase para habilitar la seguridad multi-tenant.

\-- A. Tabla de Perfiles (Se crea automágicamente al registrarse)  
create table public.profiles (  
  id uuid not null references auth.users(id) on delete cascade primary key,  
  email text,  
  full\_name text,  
  avatar\_url text,  
  created\_at timestamptz default now()  
);

\-- B. Tabla de Miembros (Vincula Usuarios con Proyectos/Orgs)  
create table public.project\_members (  
  id uuid primary key default gen\_random\_uuid(),  
  project\_id uuid references public.projects(id) on delete cascade not null,  
  user\_id uuid references public.profiles(id) on delete cascade not null,  
  role text check (role in ('admin', 'editor', 'viewer')) default 'viewer',  
  created\_at timestamptz default now(),  
    
  \-- Un usuario no puede estar duplicado en el mismo proyecto  
  unique(project\_id, user\_id)  
);

\-- C. API Keys para el MCP (Para que Claude se conecte)  
create table public.project\_api\_keys (  
  id uuid primary key default gen\_random\_uuid(),  
  project\_id uuid references public.projects(id) on delete cascade not null,  
  key\_hash text not null, \-- Guardamos el hash, nunca la llave raw  
  label text, \-- ej: "Claude Desktop MacBook Pro"  
  created\_at timestamptz default now()  
);

\-- D. Habilitar RLS (Row Level Security) \- ¡CRÍTICO\!  
alter table public.projects enable row level security;  
alter table public.documents enable row level security;  
alter table public.document\_proposals enable row level security;  
alter table public.project\_members enable row level security;

\-- E. Helper Function: ¿Tiene acceso el usuario actual al proyecto X?  
create or replace function public.has\_project\_access(target\_project\_id uuid)  
returns boolean as $$  
begin  
  return exists (  
    select 1 from public.project\_members  
    where user\_id \= auth.uid()  
    and project\_id \= target\_project\_id  
  );  
end;  
$$ language plpgsql security definer;

### **3\. Políticas de Seguridad (The Policies)**

Estas reglas son las que realmente protegen los datos. Postgres las ejecuta antes de devolver cualquier dato.

\-- 1\. Políticas para PROYECTOS  
\-- "Solo puedo ver proyectos donde soy miembro"  
create policy "Users can view their own projects"  
on public.projects for select  
using ( exists (  
  select 1 from public.project\_members  
  where user\_id \= auth.uid()  
  and project\_id \= public.projects.id  
));

\-- 2\. Políticas para DOCUMENTOS  
\-- "Solo puedo ver/editar documentos de mis proyectos"  
create policy "Users can view documents of their projects"  
on public.documents for select  
using ( public.has\_project\_access(project\_id) );

create policy "Editors can insert documents"  
on public.documents for insert  
with check (  
  exists (  
    select 1 from public.project\_members  
    where user\_id \= auth.uid()  
    and project\_id \= public.documents.project\_id  
    and role in ('admin', 'editor')  
  )  
);

\-- 3\. Políticas para PROPUESTAS (Shadow Log)  
create policy "Access to proposals based on membership"  
on public.document\_proposals for all  
using ( public.has\_project\_access(project\_id) );

### **4\. Integración en el Dashboard (Next.js)**

En tu aplicación Next.js, simplemente usas el cliente de Supabase. RLS se encarga del resto.

// app/dashboard/page.tsx  
const supabase \= createClientComponentClient();

// ¡MAGIA\! Esta query automáticamente filtra solo los proyectos del usuario.  
// No necesitas agregar "where user\_id \= ..." manualmente.  
const { data: projects } \= await supabase.from('projects').select('\*');

### **5\. Integración con MCP (El reto de la API Key)**

El servidor MCP no tiene un usuario logueado en el navegador. Usa una API Key (QUOTH\_API\_KEY).

**Estrategia de Middleware para MCP:**

1. Claude envía QUOTH\_API\_KEY en los headers.  
2. Tu servidor MCP (lib/mcp/server.ts) intercepta la request.  
3. Busca en la tabla project\_api\_keys.  
4. Si es válida, obtiene el project\_id.  
5. **Importante:** Usa el SUPABASE\_SERVICE\_ROLE\_KEY para hacer las consultas en nombre de ese proyecto, ya que RLS está diseñado para usuarios humanos (auth.uid()).  
   * *Alternativa:* Puedes simular un usuario usando supabase.auth.signInWithPassword en background, pero usar Service Role \+ Filtro manual (where project\_id \= ...) es más rápido para APIs server-to-server.

// lib/mcp/auth.ts  
export async function validateMcpRequest(apiKey: string) {  
  // Hash the key provided by Claude  
  const hashedKey \= hash(apiKey);   
    
  const { data } \= await supabaseAdmin  
    .from('project\_api\_keys')  
    .select('project\_id')  
    .eq('key\_hash', hashedKey)  
    .single();  
      
  if (\!data) throw new Error("Unauthorized");  
  return data.project\_id;  
}

// En tus tools:  
const projectId \= await validateMcpRequest(headers.authorization);  
// Ahora pasas projectId a todas tus funciones de búsqueda/escritura

### **6\. Roles y Permisos (Governance)**

Podemos refinar el "Gatekeeper" usando los roles definidos en project\_members.

* **Viewer:** Solo puede usar quoth\_search\_index.  
* **Editor:** Puede usar quoth\_propose\_update.  
* **Admin:** Puede aprobar propuestas en el Dashboard.

### **7\. Trigger de Auto-Perfil**

Para que auth.users y public.profiles estén sincronizados automáticamente:

create or replace function public.handle\_new\_user()  
returns trigger as $$  
begin  
  insert into public.profiles (id, full\_name, avatar\_url)  
  values (new.id, new.raw\_user\_meta\_data-\>\>'full\_name', new.raw\_user\_meta\_data-\>\>'avatar\_url');  
  return new;  
end;  
$$ language plpgsql security definer;

create trigger on\_auth\_user\_created  
  after insert on auth.users  
  for each row execute procedure public.handle\_new\_user();  
