import { createClient } from '@supabase/supabase-js';
import { Session } from '../../App';

// Create Supabase client for realtime functionality
export function createRealtimeClient() {
  const supabaseUrl = localStorage.getItem('speechflow-supabase-url') || 'https://fvcaaabhhbspnpmjoovo.supabase.co';
  const supabaseKey = localStorage.getItem('speechflow-supabase-anon-key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2Y2FhYWJoaGJzcG5wbWpvb3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMDMyMjgsImV4cCI6MjA3MDU3OTIyOH0.Vd4p7rY_liOM7HGbciAr0cL2Fdgol0ywydRCGI8ZB1M';
  
  return createClient(supabaseUrl, supabaseKey, {
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
}

export interface CollaborationSession {
  id: string;
  title: string;
  shareCode: string;
  ownerId: string;
  participants: CollaborationParticipant[];
  lastUpdated: Date;
  sessionData: Session;
}

export interface CollaborationParticipant {
  id: string;
  name: string;
  role: 'input' | 'feedback' | 'viewer';
  isOnline: boolean;
  lastSeen: Date;
}

export interface RealtimeSessionUpdate {
  type: 'session_update' | 'participant_joined' | 'participant_left' | 'feedback_generated';
  sessionId: string;
  data: any;
  timestamp: Date;
  userId: string;
}

export class RealtimeCollaboration {
  private client = createRealtimeClient();
  private currentChannel: any = null;
  private onSessionUpdateCallback?: (update: RealtimeSessionUpdate) => void;
  private onParticipantsUpdateCallback?: (participants: CollaborationParticipant[]) => void;

  // Generate a shareable session code
  generateShareCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create a new collaboration session
  async createCollaborationSession(session: Session, ownerName: string): Promise<CollaborationSession> {
    const shareCode = this.generateShareCode();
    const collabSession: CollaborationSession = {
      id: session.id,
      title: session.title,
      shareCode,
      ownerId: 'owner-' + Date.now(),
      participants: [{
        id: 'owner-' + Date.now(),
        name: ownerName,
        role: 'input',
        isOnline: true,
        lastSeen: new Date()
      }],
      lastUpdated: new Date(),
      sessionData: session
    };

    // Store collaboration session data
    await this.saveCollaborationSession(collabSession);
    return collabSession;
  }

  // Join an existing collaboration session
  async joinCollaborationSession(shareCode: string, participantName: string, role: 'input' | 'feedback' | 'viewer'): Promise<CollaborationSession | null> {
    try {
      const collabSession = await this.loadCollaborationSessionByCode(shareCode);
      if (!collabSession) return null;

      const newParticipant: CollaborationParticipant = {
        id: 'participant-' + Date.now(),
        name: participantName,
        role,
        isOnline: true,
        lastSeen: new Date()
      };

      collabSession.participants.push(newParticipant);
      collabSession.lastUpdated = new Date();

      await this.saveCollaborationSession(collabSession);
      return collabSession;
    } catch (error) {
      console.error('Error joining collaboration session:', error);
      return null;
    }
  }

  // Subscribe to real-time updates for a session
  subscribeToSession(sessionId: string, callbacks: {
    onSessionUpdate?: (update: RealtimeSessionUpdate) => void;
    onParticipantsUpdate?: (participants: CollaborationParticipant[]) => void;
  }) {
    this.onSessionUpdateCallback = callbacks.onSessionUpdate;
    this.onParticipantsUpdateCallback = callbacks.onParticipantsUpdate;

    // Unsubscribe from previous channel if exists
    if (this.currentChannel) {
      this.client.removeChannel(this.currentChannel);
    }

    // Create new channel for this session
    this.currentChannel = this.client.channel(`session:${sessionId}`);

    // Listen for session updates
    this.currentChannel.on('broadcast', { event: 'session_update' }, (payload: any) => {
      if (this.onSessionUpdateCallback) {
        this.onSessionUpdateCallback(payload);
      }
    });

    // Listen for participant updates
    this.currentChannel.on('broadcast', { event: 'participants_update' }, (payload: any) => {
      if (this.onParticipantsUpdateCallback) {
        this.onParticipantsUpdateCallback(payload.participants);
      }
    });

    // Subscribe to the channel
    this.currentChannel.subscribe();
  }

  // Broadcast a session update to all participants
  async broadcastSessionUpdate(sessionId: string, updateType: string, data: any) {
    if (!this.currentChannel) return;

    const update: RealtimeSessionUpdate = {
      type: updateType as any,
      sessionId,
      data,
      timestamp: new Date(),
      userId: 'current-user' // This would be the actual user ID in a real implementation
    };

    await this.currentChannel.send({
      type: 'broadcast',
      event: 'session_update',
      payload: update
    });
  }

  // Broadcast participant list update
  async broadcastParticipantsUpdate(sessionId: string, participants: CollaborationParticipant[]) {
    if (!this.currentChannel) return;

    await this.currentChannel.send({
      type: 'broadcast',
      event: 'participants_update',
      payload: { participants }
    });
  }

  // Unsubscribe from session updates
  unsubscribeFromSession() {
    if (this.currentChannel) {
      this.client.removeChannel(this.currentChannel);
      this.currentChannel = null;
    }
    this.onSessionUpdateCallback = undefined;
    this.onParticipantsUpdateCallback = undefined;
  }

  // Save collaboration session to database
  private async saveCollaborationSession(collabSession: CollaborationSession): Promise<void> {
    try {
      // Using the KV store for simplicity - in a real app you'd use proper database tables
      const key = `collab_session:${collabSession.shareCode}`;
      await fetch(`https://fvcaaabhhbspnpmjoovo.supabase.co/functions/v1/make-server-a0d800ba/kv/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('speechflow-supabase-anon-key')}`
        },
        body: JSON.stringify({
          key,
          value: JSON.stringify(collabSession)
        })
      });
    } catch (error) {
      console.error('Error saving collaboration session:', error);
      throw error;
    }
  }

  // Load collaboration session by share code
  private async loadCollaborationSessionByCode(shareCode: string): Promise<CollaborationSession | null> {
    try {
      const key = `collab_session:${shareCode}`;
      const response = await fetch(`https://fvcaaabhhbspnpmjoovo.supabase.co/functions/v1/make-server-a0d800ba/kv/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('speechflow-supabase-anon-key')}`
        },
        body: JSON.stringify({ key })
      });

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.value) return null;

      return JSON.parse(data.value);
    } catch (error) {
      console.error('Error loading collaboration session:', error);
      return null;
    }
  }
}