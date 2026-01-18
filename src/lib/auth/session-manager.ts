/**
 * MCP Session Manager
 * Handles multiple authenticated project contexts per MCP connection
 * 
 * Strategy: In-memory session storage (fast, survives per-process lifetime)
 * Accounts: Auto-discovered from project_members table
 * Default: Auto-selects user's default_project_id as active
 */

export interface ProjectContext {
  project_id: string;
  role: 'admin' | 'editor' | 'viewer';
  project_name: string;
  project_slug: string;
}

export interface SessionData {
  user_id: string;
  active_project_id: string;
  active_role: 'admin' | 'editor' | 'viewer';
  available_projects: ProjectContext[];
  created_at: Date;
  last_used_at: Date;
}

class McpSessionManager {
  private sessions: Map<string, SessionData> = new Map();
  
  /**
   * Initialize or update session from auth context
   * @param connectionId - Unique identifier for the MCP connection
   * @param userId - User ID from authentication
   * @param projectId - Active project ID
   * @param role - User's role in the active project
   * @param availableProjects - All projects user has access to
   */
  createOrUpdateSession(
    connectionId: string,
    userId: string,
    projectId: string,
    role: 'admin' | 'editor' | 'viewer',
    availableProjects: ProjectContext[]
  ): void {
    const existing = this.sessions.get(connectionId);
    
    this.sessions.set(connectionId, {
      user_id: userId,
      active_project_id: projectId,
      active_role: role,
      available_projects: availableProjects,
      created_at: existing?.created_at || new Date(),
      last_used_at: new Date(),
    });
  }
  
  /**
   * Switch active account to a different project
   * @param connectionId - MCP connection identifier
   * @param projectId - Target project ID to switch to
   * @returns true if switch successful, false if project not found or connection invalid
   */
  switchAccount(connectionId: string, projectId: string): boolean {
    const session = this.sessions.get(connectionId);
    if (!session) {
      console.warn(`[SessionManager] No session found for connection ${connectionId}`);
      return false;
    }
    
    const targetProject = session.available_projects.find(
      p => p.project_id === projectId
    );
    
    if (!targetProject) {
      console.warn(
        `[SessionManager] Project ${projectId} not found in available projects for user ${session.user_id}`
      );
      return false;
    }
    
    console.log(
      `[SessionManager] Switching connection ${connectionId} from ${session.active_project_id} to ${projectId}`
    );
    
    session.active_project_id = targetProject.project_id;
    session.active_role = targetProject.role;
    session.last_used_at = new Date();
    
    return true;
  }
  
  /**
   * Get active project context for a connection
   * @param connectionId - MCP connection identifier
   * @returns Active project ID and role, or null if session not found
   */
  getActiveContext(connectionId: string): { project_id: string; role: 'admin' | 'editor' | 'viewer' } | null {
    const session = this.sessions.get(connectionId);
    if (!session) return null;
    
    return {
      project_id: session.active_project_id,
      role: session.active_role,
    };
  }
  
  /**
   * List all accounts for a connection
   * @param connectionId - MCP connection identifier
   * @returns Active project and list of all available accounts
   */
  listAccounts(connectionId: string): { active_project_id: string; accounts: ProjectContext[] } | null {
    const session = this.sessions.get(connectionId);
    if (!session) return null;
    
    return {
      active_project_id: session.active_project_id,
      accounts: session.available_projects,
    };
  }
  
  /**
   * Cleanup session when connection closes
   * @param connectionId - MCP connection identifier
   */
  removeSession(connectionId: string): void {
    const removed = this.sessions.delete(connectionId);
    if (removed) {
      console.log(`[SessionManager] Removed session for connection ${connectionId}`);
    }
  }
  
  /**
   * Get total number of active sessions (for debugging/monitoring)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
  
  /**
   * Cleanup stale sessions (older than 24 hours since last use)
   * Should be called periodically by a cleanup job
   */
  cleanupStaleSessions(): number {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    let cleaned = 0;
    
    for (const [connectionId, session] of this.sessions.entries()) {
      const age = now.getTime() - session.last_used_at.getTime();
      if (age > maxAge) {
        this.sessions.delete(connectionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[SessionManager] Cleaned up ${cleaned} stale sessions`);
    }
    
    return cleaned;
  }
}

// Singleton instance
export const sessionManager = new McpSessionManager();

// Optional: Periodic cleanup of stale sessions (runs every hour)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    sessionManager.cleanupStaleSessions();
  }, 60 * 60 * 1000); // 1 hour
}
