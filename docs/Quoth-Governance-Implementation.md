# **Quoth Governance Implementation: From Shadow to Autonomous**

Strategy: Progressive Enhancement.  
Phase 1: Shadow Log (Storage & Manual Review).  
Phase 2: The Gatekeeper (AI Automation & Notification).

## **Paso 1: Los Cimientos (Shadow Database)**

*Esto es necesario para ambas estrategias. Es el "limbo" donde viven los cambios antes de ser reales.*

Ejecuta este SQL en Supabase. Agrega columnas para soportar tanto la revisión humana como la automática.

\-- Habilitar extensión UUID si no existe  
create extension if not exists "uuid-ossp";

\-- Tabla Unificada de Propuestas  
create table document\_proposals (  
  id uuid primary key default uuid\_generate\_v4(),  
  project\_id uuid references projects(id) not null,  
  file\_path text not null,  
    
  \-- Content Snapshots  
  original\_content text,  
  proposed\_content text not null,  
    
  \-- The "Why" (Vital para el Juez AI)  
  reasoning text not null,  
  evidence\_snippet text,  
    
  \-- Status Flow  
  status text check (status in ('pending', 'approved', 'rejected', 'applied', 'pending\_human\_review')) default 'pending',  
    
  \-- Governance Metadata (Para Phase 2\)  
  risk\_score int, \-- 0-100  
  ai\_verdict jsonb, \-- { "analysis": "...", "confidence": 98 }  
  is\_auto\_approved boolean default false,  
    
  created\_at timestamp with time zone default now(),  
  updated\_at timestamp with time zone default now()  
);

\-- Trigger para actualizar \`updated\_at\`  
create or replace function update\_modified\_column()  
returns trigger as $$  
begin  
    new.updated\_at \= now();  
    return new;  
end;  
$$ language 'plpgsql';

create trigger update\_proposals\_modtime  
    before update on document\_proposals  
    for each row execute procedure update\_modified\_column();

## **Paso 2: La Herramienta de Entrada (The Propose Tool)**

*Implementa esto primero. Funciona igual para modo manual o autónomo.*

// lib/mcp/tools/write.ts  
export async function proposeUpdate(args: {  
  doc\_id: string,  
  new\_content: string,  
  reasoning: string,  
  evidence: string  
}) {  
  // 1\. Snapshot del estado actual  
  const { data: currentDoc } \= await supabase  
    .from('documents')  
    .select('content, file\_path, project\_id')  
    .eq('file\_path', args.doc\_id)  
    .single();

  // 2\. Guardar en el Shadow Log (Siempre PENDING al inicio)  
  const { data: proposal } \= await supabase  
    .from('document\_proposals')  
    .insert({  
      project\_id: currentDoc.project\_id,  
      file\_path: currentDoc.file\_path,  
      original\_content: currentDoc.content,  
      proposed\_content: args.new\_content,  
      reasoning: args.reasoning,  
      evidence\_snippet: args.evidence,  
      status: 'pending'   
    })  
    .select()  
    .single();

  // 3\. EL SWITCH: Decidir si activamos al Juez inmediatamente  
  if (process.env.ENABLE\_AUTONOMOUS\_MODE \=== 'true') {  
     // Disparar evaluación asíncrona (sin bloquear al usuario)  
     triggerGatekeeper(proposal.id);   
     return { message: "Propuesta recibida. El Juez Automático la está evaluando." };  
  }

  return { message: "Propuesta guardada. Esperando revisión humana." };  
}

## **Paso 3: El Cerebro (The Gatekeeper Logic)**

*Esta es la lógica que implementas para pasar a la Fase 2\.*

// lib/governance/gatekeeper.ts  
import { generateObject } from 'ai';  
import { google } from '@ai-sdk/google';

export async function adjudicateProposal(proposalId: string) {  
  const proposal \= await getProposal(proposalId);

  // 1\. El Juicio  
  const { object: judgment } \= await generateObject({  
    model: google('gemini-1.5-pro'),   
    system: \`Eres el Gatekeeper de Quoth. Tu trabajo es proteger la documentación.  
             Criterios de Aprobación Automática:  
             1\. Correcciones de sintaxis/typos: APROBAR.  
             2\. Aclaraciones que no cambian reglas: APROBAR.  
             3\. Cambios de reglas arquitectónicas (ej: Auth, DB): RECHAZAR (Escalar a humano).  
             4\. Borrado de contenido sin reemplazo: RECHAZAR.\`,  
    prompt: \`Original: ${proposal.original\_content}\\nPropuesta: ${proposal.proposed\_content}\\nRazón: ${proposal.reasoning}\`,  
    schema: z.object({  
      verdict: z.enum(\['APPROVE', 'ESCALATE', 'REJECT'\]),  
      risk\_score: z.number().min(0).max(100),  
      reason: z.string()  
    })  
  });

  // 2\. La Ejecución  
  if (judgment.verdict \=== 'APPROVE') {  
    await applyCommitToGitHub(proposal); // Escribe en GitHub  
    await updateProposalStatus(proposalId, 'applied', judgment);  
    await sendNotificationEmail(proposal, judgment); // Avisa por Resend  
  } else if (judgment.verdict \=== 'ESCALATE') {  
    await updateProposalStatus(proposalId, 'pending\_human\_review', judgment);  
    await sendNotificationEmail(proposal, judgment); // Avisa "Se requiere tu atención"  
  } else {  
    await updateProposalStatus(proposalId, 'rejected', judgment);  
  }  
}

## **Paso 4: El Ejecutor (GitHub Writer)**

*Abstrae la escritura a GitHub para que pueda ser llamada por el Humano (botón en dashboard) o por la IA.*

// lib/github/writer.ts  
import { Octokit } from "@octokit/rest";

export async function applyCommitToGitHub(proposal: Proposal) {  
  const octokit \= new Octokit({ auth: process.env.GITHUB\_TOKEN });  
    
  // Obtener SHA actual para evitar conflictos  
  const { data: fileData } \= await octokit.repos.getContent({  
    owner: process.env.GITHUB\_OWNER,  
    repo: process.env.GITHUB\_REPO,  
    path: proposal.file\_path,  
  });

  // Commit directo a Main (Autonomous Mode)  
  await octokit.repos.createOrUpdateFileContents({  
    owner: process.env.GITHUB\_OWNER,  
    repo: process.env.GITHUB\_REPO,  
    path: proposal.file\_path,  
    message: \`docs(quoth): auto-update ${proposal.file\_path} \[skip ci\]\`,  
    content: Buffer.from(proposal.proposed\_content).toString('base64'),  
    sha: (fileData as any).sha,  
  });  
}

## **Resumen del Plan de Batalla**

1. **Semana 1 (Shadow Mode):**  
   * Crea la tabla en Supabase.  
   * Implementa la tool proposeUpdate sin el trigger automático.  
   * Instala el Dashboard (una página simple en Next.js) que lea de document\_proposals y tenga un botón "Approve" que llame a applyCommitToGitHub.  
   * **Resultado:** Tienes control total. Ves lo que la IA quiere hacer y tú le das click.  
2. **Semana 2 (The Switch):**  
   * Implementa lib/governance/gatekeeper.ts (El Juez con Gemini).  
   * Configura Resend para los emails.  
   * Cambia la variable de entorno ENABLE\_AUTONOMOUS\_MODE=true.  
   * **Resultado:** Quoth empieza a trabajar solo. Tú solo recibes emails de "FYI" o "Necesito ayuda".

Esta aproximación te permite validar que la IA no está "loca" antes de darle las llaves del coche.