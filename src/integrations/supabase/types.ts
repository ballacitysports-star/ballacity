export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auth_signin_events: {
        Row: {
          browser: string | null
          created_at: string
          error_message: string | null
          event: string
          id: string
          is_in_app_webview: boolean | null
          is_ios: boolean | null
          is_ios_chrome: boolean | null
          platform: string | null
          provider: string
          user_agent: string | null
          user_id: string | null
          viewport_height: number | null
          viewport_width: number | null
        }
        Insert: {
          browser?: string | null
          created_at?: string
          error_message?: string | null
          event: string
          id?: string
          is_in_app_webview?: boolean | null
          is_ios?: boolean | null
          is_ios_chrome?: boolean | null
          platform?: string | null
          provider?: string
          user_agent?: string | null
          user_id?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Update: {
          browser?: string | null
          created_at?: string
          error_message?: string | null
          event?: string
          id?: string
          is_in_app_webview?: boolean | null
          is_ios?: boolean | null
          is_ios_chrome?: boolean | null
          platform?: string | null
          provider?: string
          user_agent?: string | null
          user_id?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Relationships: []
      }
      availability_contact_requests: {
        Row: {
          availability_id: string
          created_at: string
          from_user_id: string
          game_id: string | null
          game_location: string | null
          game_sport: string | null
          game_starts_at: string | null
          game_title: string | null
          id: string
          kind: string
          message: string | null
          status: string
          to_user_id: string
          updated_at: string
        }
        Insert: {
          availability_id: string
          created_at?: string
          from_user_id: string
          game_id?: string | null
          game_location?: string | null
          game_sport?: string | null
          game_starts_at?: string | null
          game_title?: string | null
          id?: string
          kind?: string
          message?: string | null
          status?: string
          to_user_id: string
          updated_at?: string
        }
        Update: {
          availability_id?: string
          created_at?: string
          from_user_id?: string
          game_id?: string | null
          game_location?: string | null
          game_sport?: string | null
          game_starts_at?: string | null
          game_title?: string | null
          id?: string
          kind?: string
          message?: string | null
          status?: string
          to_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_contact_requests_availability_id_fkey"
            columns: ["availability_id"]
            isOneToOne: false
            referencedRelation: "player_availabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          game_id: string | null
          id: string
          last_message_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          game_id?: string | null
          id?: string
          last_message_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          game_id?: string | null
          id?: string
          last_message_at?: string
        }
        Relationships: []
      }
      game_participants: {
        Row: {
          created_at: string
          game_id: string
          id: string
          position: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          position?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          position?: string | null
          user_id?: string
        }
        Relationships: []
      }
      game_payment_settings: {
        Row: {
          accepted_method_ids: string[]
          created_at: string
          entry_fee: number
          game_id: string
          host_id: string
          id: string
          payment_deadline: string | null
          payment_instructions: string | null
          refund_policy: string | null
          requires_approval: boolean
          updated_at: string
        }
        Insert: {
          accepted_method_ids?: string[]
          created_at?: string
          entry_fee?: number
          game_id: string
          host_id: string
          id?: string
          payment_deadline?: string | null
          payment_instructions?: string | null
          refund_policy?: string | null
          requires_approval?: boolean
          updated_at?: string
        }
        Update: {
          accepted_method_ids?: string[]
          created_at?: string
          entry_fee?: number
          game_id?: string
          host_id?: string
          id?: string
          payment_deadline?: string | null
          payment_instructions?: string | null
          refund_policy?: string | null
          requires_approval?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      game_position_waitlist: {
        Row: {
          created_at: string
          game_id: string
          id: string
          position: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          position: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          position?: string
          user_id?: string
        }
        Relationships: []
      }
      highlight_reels: {
        Row: {
          ai_caption: string | null
          ai_hashtags: string[] | null
          ai_title: string | null
          attempts: number
          completed_at: string | null
          created_at: string
          environment: string
          error_message: string | null
          failed_at: string | null
          id: string
          last_step_at: string | null
          processing_started_at: string | null
          processing_step: string
          status: string
          step_progress: Json
          thumbnail_path: string | null
          title: string
          used_free: boolean
          user_id: string
          video_path: string
        }
        Insert: {
          ai_caption?: string | null
          ai_hashtags?: string[] | null
          ai_title?: string | null
          attempts?: number
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_step_at?: string | null
          processing_started_at?: string | null
          processing_step?: string
          status?: string
          step_progress?: Json
          thumbnail_path?: string | null
          title?: string
          used_free?: boolean
          user_id: string
          video_path: string
        }
        Update: {
          ai_caption?: string | null
          ai_hashtags?: string[] | null
          ai_title?: string | null
          attempts?: number
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_step_at?: string | null
          processing_started_at?: string | null
          processing_step?: string
          status?: string
          step_progress?: Json
          thumbnail_path?: string | null
          title?: string
          used_free?: boolean
          user_id?: string
          video_path?: string
        }
        Relationships: []
      }
      host_payment_methods: {
        Row: {
          contact_info: string | null
          created_at: string
          host_id: string
          id: string
          instructions: string | null
          is_enabled: boolean
          label: string | null
          payment_type: string
          payment_url: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          host_id: string
          id?: string
          instructions?: string | null
          is_enabled?: boolean
          label?: string | null
          payment_type: string
          payment_url?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          host_id?: string
          id?: string
          instructions?: string | null
          is_enabled?: boolean
          label?: string | null
          payment_type?: string
          payment_url?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      hosted_games: {
        Row: {
          created_at: string
          date: string
          description: string
          distance_mi: number
          duration: string
          equipment: string[]
          host_id: string
          host_snapshot: Json
          id: string
          image: string
          indoor: boolean
          is_private: boolean
          joined: number
          joins_closed: boolean
          lat: number
          lng: number
          location: string
          max_players: number
          neighborhood: string
          positions_needed: Json
          price: number
          skill: string
          sport: string
          status: string | null
          title: string
          trending: boolean
          updated_at: string
          urgent: boolean
        }
        Insert: {
          created_at?: string
          date: string
          description?: string
          distance_mi?: number
          duration?: string
          equipment?: string[]
          host_id: string
          host_snapshot?: Json
          id: string
          image?: string
          indoor?: boolean
          is_private?: boolean
          joined?: number
          joins_closed?: boolean
          lat?: number
          lng?: number
          location?: string
          max_players?: number
          neighborhood?: string
          positions_needed?: Json
          price?: number
          skill?: string
          sport: string
          status?: string | null
          title: string
          trending?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          created_at?: string
          date?: string
          description?: string
          distance_mi?: number
          duration?: string
          equipment?: string[]
          host_id?: string
          host_snapshot?: Json
          id?: string
          image?: string
          indoor?: boolean
          is_private?: boolean
          joined?: number
          joins_closed?: boolean
          lat?: number
          lng?: number
          location?: string
          max_players?: number
          neighborhood?: string
          positions_needed?: Json
          price?: number
          skill?: string
          sport?: string
          status?: string | null
          title?: string
          trending?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Relationships: []
      }
      join_requests: {
        Row: {
          attempt_count: number
          created_at: string
          game_id: string
          host_id: string
          id: string
          idempotency_key: string
          last_rejected_at: string | null
          message: string | null
          player_id: string
          reviewed_at: string | null
          reviewer_notes: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          game_id: string
          host_id: string
          id?: string
          idempotency_key: string
          last_rejected_at?: string | null
          message?: string | null
          player_id: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          game_id?: string
          host_id?: string
          id?: string
          idempotency_key?: string
          last_rejected_at?: string | null
          message?: string | null
          player_id?: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: string
        }
        Relationships: []
      }
      location_denial_events: {
        Row: {
          code: number | null
          created_at: string
          id: string
          message: string | null
          permission_state: string | null
          reason: string
          sport: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          code?: number | null
          created_at?: string
          id?: string
          message?: string | null
          permission_state?: string | null
          reason: string
          sport?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          code?: number | null
          created_at?: string
          id?: string
          message?: string | null
          permission_state?: string | null
          reason?: string
          sport?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          attachment_type: string | null
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_log: {
        Row: {
          channel: string
          created_at: string
          detail: Json | null
          error: string | null
          id: string
          notification_id: string | null
          provider: string | null
          status: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          detail?: Json | null
          error?: string | null
          id?: string
          notification_id?: string | null
          provider?: string | null
          status: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          detail?: Json | null
          error?: string | null
          id?: string
          notification_id?: string | null
          provider?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_log_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_submissions: {
        Row: {
          game_id: string
          host_id: string
          id: string
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_method_id: string | null
          payment_type: string | null
          player_id: string
          reviewed_at: string | null
          reviewer_notes: string | null
          screenshot_path: string | null
          status: string
          submitted_at: string
          transaction_reference: string | null
        }
        Insert: {
          game_id: string
          host_id: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method_id?: string | null
          payment_type?: string | null
          player_id: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          screenshot_path?: string | null
          status?: string
          submitted_at?: string
          transaction_reference?: string | null
        }
        Update: {
          game_id?: string
          host_id?: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method_id?: string | null
          payment_type?: string | null
          player_id?: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          screenshot_path?: string | null
          status?: string
          submitted_at?: string
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_submissions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "host_payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      player_availabilities: {
        Row: {
          city: string | null
          created_at: string
          ends_on: string | null
          id: string
          note: string | null
          recurring_days: string[]
          skill_level: string
          sports: string[]
          starts_on: string | null
          status: string
          travel_radius_km: number
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          note?: string | null
          recurring_days?: string[]
          skill_level?: string
          sports?: string[]
          starts_on?: string | null
          status?: string
          travel_radius_km?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          note?: string | null
          recurring_days?: string[]
          skill_level?: string
          sports?: string[]
          starts_on?: string | null
          status?: string
          travel_radius_km?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_initials: string | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          display_name: string
          graduating_class: number | null
          id: string
          links: Json
          skill_levels: Json
          sport: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_initials?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string
          graduating_class?: number | null
          id: string
          links?: Json
          skill_levels?: Json
          sport?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_initials?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string
          graduating_class?: number | null
          id?: string
          links?: Json
          skill_levels?: Json
          sport?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount_total: number
          created_at: string
          currency: string
          customer_email: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          quantity: number
          shipping_address: Json | null
          shipping_name: string | null
          status: string
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          user_id: string | null
        }
        Insert: {
          amount_total: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          quantity?: number
          shipping_address?: Json | null
          shipping_name?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          user_id?: string | null
        }
        Update: {
          amount_total?: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          quantity?: number
          shipping_address?: Json | null
          shipping_name?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      review_helpfuls: {
        Row: {
          created_at: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_helpfuls_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string
          context: string | null
          created_at: string
          flagged: boolean
          helpful_count: number
          id: string
          is_private: boolean
          kind: string
          rating: number
          reviewee_id: string
          reviewee_kind: string
          reviewee_name: string
          reviewer_id: string
          scores: Json
          title: string | null
          verified: boolean
        }
        Insert: {
          body: string
          context?: string | null
          created_at?: string
          flagged?: boolean
          helpful_count?: number
          id?: string
          is_private?: boolean
          kind: string
          rating: number
          reviewee_id: string
          reviewee_kind: string
          reviewee_name: string
          reviewer_id: string
          scores?: Json
          title?: string | null
          verified?: boolean
        }
        Update: {
          body?: string
          context?: string | null
          created_at?: string
          flagged?: boolean
          helpful_count?: number
          id?: string
          is_private?: boolean
          kind?: string
          rating?: number
          reviewee_id?: string
          reviewee_kind?: string
          reviewee_name?: string
          reviewer_id?: string
          scores?: Json
          title?: string | null
          verified?: boolean
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_notify: {
        Args: { _caller: string; _target: string }
        Returns: boolean
      }
      create_direct_conversation: {
        Args: { _game_id?: string; _other_user: string }
        Returns: string
      }
      free_reels_used: {
        Args: { check_env?: string; user_uuid: string }
        Returns: number
      }
      get_game_host_payment_methods: {
        Args: { _game_id: string; _host_id: string }
        Returns: {
          contact_info: string
          host_id: string
          id: string
          instructions: string
          is_enabled: boolean
          label: string
          payment_type: string
          payment_url: string
          username: string
        }[]
      }
      get_host_payment_methods: {
        Args: { _host_id: string }
        Returns: {
          contact_info: string
          host_id: string
          id: string
          instructions: string
          is_enabled: boolean
          label: string
          payment_type: string
          payment_url: string
          username: string
        }[]
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_conversation_participant: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator"],
    },
  },
} as const
