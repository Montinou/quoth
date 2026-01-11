Quoth Write Strategy: The "Shadow Proposal" Protocol
Cómo gestionar ediciones de IA sin romper la Fuente de Verdad1. 
El Flujo de "Escritura Segura
"La IA nunca debe tener permiso de UPDATE directo sobre la tabla documents ni commit directo a main sin supervisión.
El Flujo:
AI Action: Claude detecta que un doc está obsoleto. Llama a quoth_propose_update.
Shadow Storage: Quoth guarda el diff en la tabla document_proposals en Supabase (Estado: PENDING).
Human Review: El usuario ve la notificación (en el Dashboard o PR).
Approval: Si se aprueba -> Quoth hace un commit a GitHub vía API.
Sync Loop: El Webhook de GitHub detecta el cambio y actualiza la tabla documents (cerrando el ciclo).
2. Database Schema Update (The Shadow Log)
Agregamos una tabla para controlar estas versiones "en el limbo".

-- Tabla de Propuestas (The Shadow Log)
create table document_proposals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id), -- Null si es un archivo nuevo
  project_id uuid references projects(id) not null,
  
  -- Rutas
  file_path text not null,
  
  -- El cambio propuesto
  original_content text, -- Snapshot de cómo estaba antes (para rollback)
  proposed_content text not null, -- La nueva versión
  
  -- Metadatos de Auditoría
  reasoning text not null, -- "¿Por qué la IA quiere cambiar esto?"
  evidence_snippet text, -- Código que justifica el cambio
  
  -- Estado del Flujo
  status text check (status in ('pending', 'approved', 'rejected', 'applied')) default 'pending',
  pr_url text, -- Si se convirtió en Pull Request
  
  -- AI Governance
  risk_score int default 0, -- 1-100 (Calculado por la IA Revisora)
  auto_approved boolean default false,
  
  created_at timestamp with time zone default now(),
  reviewed_at timestamp with time zone,
  reviewed_by text
);

-- Índices para búsqueda rápida en el dashboard
create index idx_proposals_status on document_proposals(status);
create index idx_proposals_project on document_proposals(project_id);

3. Tool Implementation: quoth_propose_update

Esta herramienta ya no es un simple console.log, ahora escribe en el Shadow Log.



// lib/mcp/tools/write.ts

export async function proposeUpdate(args: {
  doc_id: string,
  new_content: string,
  reasoning: string,
  evidence: string
}) {
  // 1. Obtener el contenido actual para tener un snapshot (Safety)
  const { data: currentDoc } = await supabase
    .from('documents')
    .select('content, file_path, project_id')
    .eq('file_path', args.doc_id) // Asumiendo que doc_id es el path o UUID
    .single();

  if (!currentDoc) throw new Error("Documento base no encontrado");

  // 2. Insertar en el Shadow Log (No toca la verdad oficial todavía)
  const { data: proposal, error } = await supabase
    .from('document_proposals')
    .insert({
      document_id: args.doc_id, // Si usamos UUIDs
      project_id: currentDoc.project_id,
      file_path: currentDoc.file_path,
      original_content: currentDoc.content, // Guardamos versión anterior aquí
      proposed_content: args.new_content,
      reasoning: args.reasoning,
      evidence_snippet: args.evidence,
      status: 'pending'
    })
    .select()
    .single();

  if (error) throw error;

  // 3. Respuesta a Claude
  return {
    status: "success",
    message: `Propuesta registrada (ID: ${proposal.id}). Esperando aprobación humana.`,
    diff_preview: "Diferencia guardada en base de datos para revisión."
  };
}
4. El Mecanismo de Aprobación (Commit Back)

¿Qué pasa cuando el humano dice "Sí"? Aquí es donde la IA modifica GitHub.

Necesitas un endpoint en tu API (POST /api/proposals/:id/approve) que haga lo siguiente:



// lib/github-writer.ts (Solo corre tras aprobación humana)

export async function applyProposalToGitHub(proposalId: string) {
  // 1. Leer la propuesta
  const proposal = await getProposal(proposalId);
  
  // 2. Usar Octokit para crear un commit directo o PR
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  
  // Opción A: Commit directo a main (Rápido, para equipos pequeños)
  await octokit.repos.createOrUpdateFileContents({
    owner: 'org',
    repo: 'repo',
    path: proposal.file_path,
    message: `chore(quoth): update docs based on audit ${proposal.id}`,
    content: Buffer.from(proposal.proposed_content).toString('base64'),
    sha: await getCurrentFileSha(proposal.file_path) // Necesario para updates atómicos
  });
  
  // Opción B (Recomendada): Crear un PR
  // ... lógica de crear branch + PR ...

  // 3. Marcar propuesta como 'applied'
  await updateProposalStatus(proposalId, 'applied');
  
  // NOTA: No actualizamos Supabase 'documents' aquí manualmente.
  // Esperamos a que el Webhook de GitHub dispare el Sync normal.
  // Esto garantiza que Supabase y GitHub siempre estén sincronizados eventualmente.
}
5. ¿Por qué esta arquitectura es mejor?

Safety Net (Red de Seguridad): Si la IA alucina y borra la mitad de la documentación, el cambio se queda estancado en document_proposals como pending. Nadie lo aprueba, nada se rompe.

Versionado Real: GitHub sigue manejando el historial "duro" (git blame).

Auditoría de la IA: Tienes una tabla (document_proposals) donde puedes analizar "¿Qué tan seguido se equivoca la IA?". Puedes ver el campo reasoning versus lo que el humano aprobó o rechazó.

No hay "Race Conditions": Al esperar el Webhook de GitHub para actualizar el índice de lectura (documents), evitas que Supabase diga una cosa y GitHub otra.

6. Automated Governance: The AI High Council

Para permitir que la IA apruebe cambios sin intervención humana, usamos un modelo Adversario.

El Concepto: "The Gatekeeper"

Un segundo agente (o llamada de LLM) independiente que actúa como juez.

Agente A (Architect): "Quiero cambiar esto porque el código usa vitest ahora."

Agente B (Gatekeeper): "Analizaré tu propuesta. ¿Es el cambio seguro? ¿Es trivial?"

6.1 Nueva Tool: quoth_adjudicate_proposal

Esta herramienta la usa un proceso en background (cron job o evento de Supabase), no el usuario en el chat.

Input: proposal_id

Proceso:

Carga el original_content y proposed_content.

Calcula un risk_score (0-100).

Aplica reglas de "Auto-Approval".

6.2 Criterios de Riesgo (Risk Matrix)



<system_prompt>
  <role>You are the Quoth High Council Gatekeeper.</role>
  <task>Review a documentation change proposal submitted by another AI agent.</task>
  
  <principles>
    1. **Skepticism:** Assume the proposing agent might be hallucinating. Verify the 'evidence_snippet' actually supports the change.
    2. **Conservatism:** If the change alters a fundamental architectural rule (e.g., Auth flow), REJECT auto-approval. Flag for human.
    3. **Hygiene:** If the change is purely formatting or spelling, APPROVE immediately.
  </principles>

  <output_format>
    JSON: { "approved": boolean, "risk_score": number, "reason": string }
  </output_format>
</system_prompt>
6.4 Implementación del Flujo AutomáticoClaude (User Agent) llama a quoth_propose_update.Supabase Trigger dispara una Edge Function analyze-proposal.La Edge Function llama a Claude (Gatekeeper Persona) con el prompt de arriba.Si approved === true:La Edge Function llama a applyProposalToGitHub.El cambio se aplica en segundos.Si approved === false:Se marca como pending_human_review.Se notifica al humano.Resumen Visual con IA Juez[Claude Architect] --(Propose)--> [Supabase: Proposal]
                                         │
                                   (Trigger)
                                         ▼
                                [Claude Gatekeeper (AI Judge)]
                                         │
                            ┌────────────┴────────────┐
                            ▼                         ▼
                      [Low Risk]                 [High Risk]
                          │                           │
                    (Auto-Approve)             (Wait for Human)
                          │                           │
                          ▼                           ▼
                  [GitHub Commit]             [Dashboard Alert]
