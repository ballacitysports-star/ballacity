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
      account_profiles: {
        Row: {
          created_at: string
          id: string
          kind: string
          ref_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          ref_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          ref_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      age_change_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_cohort: string | null
          id: string
          outcome: string
          to_cohort: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_cohort?: string | null
          id?: string
          outcome: string
          to_cohort?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_cohort?: string | null
          id?: string
          outcome?: string
          to_cohort?: string | null
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
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
      birthday_change_audit: {
        Row: {
          approved_birthday: string | null
          created_at: string
          id: string
          outcome: string
          previous_birthday: string | null
          reason: string | null
          request_id: string | null
          requested_birthday: string | null
          requester_id: string | null
          reviewer_id: string | null
          user_id: string
        }
        Insert: {
          approved_birthday?: string | null
          created_at?: string
          id?: string
          outcome: string
          previous_birthday?: string | null
          reason?: string | null
          request_id?: string | null
          requested_birthday?: string | null
          requester_id?: string | null
          reviewer_id?: string | null
          user_id: string
        }
        Update: {
          approved_birthday?: string | null
          created_at?: string
          id?: string
          outcome?: string
          previous_birthday?: string | null
          reason?: string | null
          request_id?: string | null
          requested_birthday?: string | null
          requester_id?: string | null
          reviewer_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      birthday_correction_requests: {
        Row: {
          created_at: string
          current_birthday: string | null
          evidence: string | null
          id: string
          reason: string
          requested_birthday: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_birthday?: string | null
          evidence?: string | null
          id?: string
          reason: string
          requested_birthday: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_birthday?: string | null
          evidence?: string | null
          id?: string
          reason?: string
          requested_birthday?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      child_controls: {
        Row: {
          ai_analysis: boolean
          child_user_id: string
          created_at: string
          game_participation: boolean
          location_precision: string
          media_visibility: string
          messaging: string
          notification_curfew_lifted: boolean
          notifications: boolean
          social_discovery: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_analysis?: boolean
          child_user_id: string
          created_at?: string
          game_participation?: boolean
          location_precision?: string
          media_visibility?: string
          messaging?: string
          notification_curfew_lifted?: boolean
          notifications?: boolean
          social_discovery?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_analysis?: boolean
          child_user_id?: string
          created_at?: string
          game_participation?: boolean
          location_precision?: string
          media_visibility?: string
          messaging?: string
          notification_curfew_lifted?: boolean
          notifications?: boolean
          social_discovery?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          accepted_by: string[]
          created_at: string
          created_by: string
          game_id: string | null
          id: string
          last_message_at: string
        }
        Insert: {
          accepted_by?: string[]
          created_at?: string
          created_by: string
          game_id?: string | null
          id?: string
          last_message_at?: string
        }
        Update: {
          accepted_by?: string[]
          created_at?: string
          created_by?: string
          game_id?: string | null
          id?: string
          last_message_at?: string
        }
        Relationships: []
      }
      data_export_requests: {
        Row: {
          categories: string[]
          created_at: string
          error_message: string | null
          expires_at: string | null
          file_bytes: number | null
          id: string
          ready_at: string | null
          requested_at: string
          row_counts: Json
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: string[]
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          file_bytes?: number | null
          id?: string
          ready_at?: string | null
          requested_at?: string
          row_counts?: Json
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: string[]
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          file_bytes?: number | null
          id?: string
          ready_at?: string | null
          requested_at?: string
          row_counts?: Json
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feed_preferences: {
        Row: {
          created_at: string
          prefs: Json
          saved_views: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          prefs?: Json
          saved_views?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          prefs?: Json
          saved_views?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: []
      }
      game_participants: {
        Row: {
          attendance_marked_at: string | null
          attendance_marked_by: string | null
          attended: boolean | null
          created_at: string
          game_id: string
          id: string
          position: string | null
          user_id: string
        }
        Insert: {
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          attended?: boolean | null
          created_at?: string
          game_id: string
          id?: string
          position?: string | null
          user_id: string
        }
        Update: {
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          attended?: boolean | null
          created_at?: string
          game_id?: string
          id?: string
          position?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_participants_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "game_payment_settings_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_position_waitlist: {
        Row: {
          created_at: string
          game_id: string
          id: string
          position: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          position: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          position?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_position_waitlist_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_reminders: {
        Row: {
          created_at: string
          game_id: string
          id: string
          last_sent_offset: number | null
          offsets: number[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          last_sent_offset?: number | null
          offsets?: number[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          last_sent_offset?: number | null
          offsets?: number[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_reminders_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_safety_acknowledgments: {
        Row: {
          accepted_at: string
          created_at: string
          game_id: string
          id: string
          kind: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          game_id: string
          id?: string
          kind: string
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          game_id?: string
          id?: string
          kind?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_safety_acknowledgments_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_links: {
        Row: {
          child_user_id: string
          created_at: string
          id: string
          parent_user_id: string
          relationship: string
          status: string
          verified_at: string | null
        }
        Insert: {
          child_user_id: string
          created_at?: string
          id?: string
          parent_user_id: string
          relationship?: string
          status?: string
          verified_at?: string | null
        }
        Update: {
          child_user_id?: string
          created_at?: string
          id?: string
          parent_user_id?: string
          relationship?: string
          status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      highlight_reels: {
        Row: {
          ai_analysis: Json | null
          ai_caption: string | null
          ai_coaching: Json | null
          ai_edit_plan: Json | null
          ai_hashtags: string[] | null
          ai_moments: Json | null
          ai_overlays: Json | null
          ai_sport: string | null
          ai_timeline: Json | null
          ai_title: string | null
          ai_transcript: Json | null
          attempts: number
          audio_path: string | null
          completed_at: string | null
          created_at: string
          environment: string
          error_message: string | null
          failed_at: string | null
          frame_paths: string[] | null
          frame_times: number[] | null
          game_id: string | null
          game_title: string | null
          hidden_at: string | null
          id: string
          last_step_at: string | null
          playback_path: string | null
          processing_started_at: string | null
          processing_step: string
          status: string
          step_progress: Json
          style_prefs: Json | null
          suggested_clip: Json | null
          thumbnail_path: string | null
          title: string
          used_free: boolean
          user_id: string
          video_path: string
        }
        Insert: {
          ai_analysis?: Json | null
          ai_caption?: string | null
          ai_coaching?: Json | null
          ai_edit_plan?: Json | null
          ai_hashtags?: string[] | null
          ai_moments?: Json | null
          ai_overlays?: Json | null
          ai_sport?: string | null
          ai_timeline?: Json | null
          ai_title?: string | null
          ai_transcript?: Json | null
          attempts?: number
          audio_path?: string | null
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          failed_at?: string | null
          frame_paths?: string[] | null
          frame_times?: number[] | null
          game_id?: string | null
          game_title?: string | null
          hidden_at?: string | null
          id?: string
          last_step_at?: string | null
          playback_path?: string | null
          processing_started_at?: string | null
          processing_step?: string
          status?: string
          step_progress?: Json
          style_prefs?: Json | null
          suggested_clip?: Json | null
          thumbnail_path?: string | null
          title?: string
          used_free?: boolean
          user_id: string
          video_path: string
        }
        Update: {
          ai_analysis?: Json | null
          ai_caption?: string | null
          ai_coaching?: Json | null
          ai_edit_plan?: Json | null
          ai_hashtags?: string[] | null
          ai_moments?: Json | null
          ai_overlays?: Json | null
          ai_sport?: string | null
          ai_timeline?: Json | null
          ai_title?: string | null
          ai_transcript?: Json | null
          attempts?: number
          audio_path?: string | null
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          failed_at?: string | null
          frame_paths?: string[] | null
          frame_times?: number[] | null
          game_id?: string | null
          game_title?: string | null
          hidden_at?: string | null
          id?: string
          last_step_at?: string | null
          playback_path?: string | null
          processing_started_at?: string | null
          processing_step?: string
          status?: string
          step_progress?: Json
          style_prefs?: Json | null
          suggested_clip?: Json | null
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
          all_day: boolean
          allow_waitlist: boolean
          arrive_early_min: number
          cancellation_notes: string | null
          cancellation_policy: string
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          date: string
          description: string
          distance_mi: number | null
          duration: string
          ends_at: string | null
          equipment: string[]
          game_rules: string | null
          hidden_at: string | null
          host_id: string
          host_snapshot: Json
          id: string
          image: string
          indoor: boolean
          is_private: boolean
          joined: number
          joins_closed: boolean
          lat: number | null
          lng: number | null
          location: string
          max_age: number | null
          max_players: number
          min_age: number | null
          min_players: number
          neighborhood: string
          org_id: string | null
          positions_needed: Json
          price: number
          reminder_offsets: number[]
          rrule: Json | null
          series_id: string | null
          signup_cutoff_min: number
          skill: string
          sport: string
          status: string | null
          team_id: string | null
          timezone: string | null
          title: string
          trending: boolean
          updated_at: string
          urgent: boolean
        }
        Insert: {
          all_day?: boolean
          allow_waitlist?: boolean
          arrive_early_min?: number
          cancellation_notes?: string | null
          cancellation_policy?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          date: string
          description?: string
          distance_mi?: number | null
          duration?: string
          ends_at?: string | null
          equipment?: string[]
          game_rules?: string | null
          hidden_at?: string | null
          host_id: string
          host_snapshot?: Json
          id: string
          image?: string
          indoor?: boolean
          is_private?: boolean
          joined?: number
          joins_closed?: boolean
          lat?: number | null
          lng?: number | null
          location?: string
          max_age?: number | null
          max_players?: number
          min_age?: number | null
          min_players?: number
          neighborhood?: string
          org_id?: string | null
          positions_needed?: Json
          price?: number
          reminder_offsets?: number[]
          rrule?: Json | null
          series_id?: string | null
          signup_cutoff_min?: number
          skill?: string
          sport: string
          status?: string | null
          team_id?: string | null
          timezone?: string | null
          title: string
          trending?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          all_day?: boolean
          allow_waitlist?: boolean
          arrive_early_min?: number
          cancellation_notes?: string | null
          cancellation_policy?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          date?: string
          description?: string
          distance_mi?: number | null
          duration?: string
          ends_at?: string | null
          equipment?: string[]
          game_rules?: string | null
          hidden_at?: string | null
          host_id?: string
          host_snapshot?: Json
          id?: string
          image?: string
          indoor?: boolean
          is_private?: boolean
          joined?: number
          joins_closed?: boolean
          lat?: number | null
          lng?: number | null
          location?: string
          max_age?: number | null
          max_players?: number
          min_age?: number | null
          min_players?: number
          neighborhood?: string
          org_id?: string | null
          positions_needed?: Json
          price?: number
          reminder_offsets?: number[]
          rrule?: Json | null
          series_id?: string | null
          signup_cutoff_min?: number
          skill?: string
          sport?: string
          status?: string | null
          team_id?: string | null
          timezone?: string | null
          title?: string
          trending?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hosted_games_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hosted_games_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      image_moderation: {
        Row: {
          bucket: string
          bytes: number | null
          created_at: string
          height: number | null
          id: string
          mime: string | null
          owner_id: string | null
          path: string
          quarantined_at: string | null
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan: Json | null
          status: string
          updated_at: string
          width: number | null
        }
        Insert: {
          bucket: string
          bytes?: number | null
          created_at?: string
          height?: number | null
          id?: string
          mime?: string | null
          owner_id?: string | null
          path: string
          quarantined_at?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan?: Json | null
          status?: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          bucket?: string
          bytes?: number | null
          created_at?: string
          height?: number | null
          id?: string
          mime?: string | null
          owner_id?: string | null
          path?: string
          quarantined_at?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan?: Json | null
          status?: string
          updated_at?: string
          width?: number | null
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
        Relationships: [
          {
            foreignKeyName: "join_requests_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_consents: {
        Row: {
          accepted_at: string
          created_at: string
          document_type: string
          document_version: string
          id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          document_type: string
          document_version: string
          id?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          document_type?: string
          document_version?: string
          id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          archived_at: string | null
          content: string
          created_at: string
          created_by: string | null
          document_type: string
          effective_date: string
          id: string
          published: boolean
          published_at: string | null
          requires_reacceptance: boolean
          summary: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          archived_at?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          document_type: string
          effective_date?: string
          id?: string
          published?: boolean
          published_at?: string | null
          requires_reacceptance?: boolean
          summary?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          archived_at?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          document_type?: string
          effective_date?: string
          id?: string
          published?: boolean
          published_at?: string | null
          requires_reacceptance?: boolean
          summary?: string
          title?: string
          updated_at?: string
          version?: string
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
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
          deleted_at: string | null
          id: string
          is_request: boolean
          read_at: string | null
          reply_to_id: string | null
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
          deleted_at?: string | null
          id?: string
          is_request?: boolean
          read_at?: string | null
          reply_to_id?: string | null
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
          deleted_at?: string | null
          id?: string
          is_request?: boolean
          read_at?: string | null
          reply_to_id?: string | null
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
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      minor_invites: {
        Row: {
          child_name: string
          child_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          parent_user_id: string
          redeemed_at: string | null
          relationship: string
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          child_name: string
          child_user_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          parent_user_id: string
          redeemed_at?: string | null
          relationship?: string
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          child_name?: string
          child_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          parent_user_id?: string
          redeemed_at?: string | null
          relationship?: string
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: []
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
      org_member_requests: {
        Row: {
          created_at: string
          denial_reason: string | null
          id: string
          message: string | null
          org_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          denial_reason?: string | null
          id?: string
          message?: string | null
          org_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          denial_reason?: string | null
          id?: string
          message?: string | null
          org_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_member_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_requests: {
        Row: {
          child_user_id: string
          created_at: string
          details: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          parent_user_id: string
          resolution_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          child_user_id: string
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          parent_user_id: string
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          child_user_id?: string
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          parent_user_id?: string
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      parental_consent_events: {
        Row: {
          action: string
          actor_id: string | null
          child_user_id: string
          consent_id: string
          created_at: string
          detail: Json
          from_status: string | null
          id: string
          method: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          child_user_id: string
          consent_id: string
          created_at?: string
          detail?: Json
          from_status?: string | null
          id?: string
          method?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          child_user_id?: string
          consent_id?: string
          created_at?: string
          detail?: Json
          from_status?: string | null
          id?: string
          method?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parental_consent_events_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "parental_consents"
            referencedColumns: ["id"]
          },
        ]
      }
      parental_consents: {
        Row: {
          approved_at: string | null
          child_policy_version: string | null
          child_user_id: string
          created_at: string
          id: string
          jurisdiction: string
          method: string
          parent_email: string | null
          parent_name: string | null
          parent_user_id: string | null
          privacy_version: string | null
          relationship: string
          requested_at: string | null
          reverify_at: string | null
          revoked_at: string | null
          revoked_reason: string | null
          scope: Json
          status: string
          terms_version: string | null
          token_expires_at: string | null
          updated_at: string
          verification_token_hash: string | null
        }
        Insert: {
          approved_at?: string | null
          child_policy_version?: string | null
          child_user_id: string
          created_at?: string
          id?: string
          jurisdiction?: string
          method?: string
          parent_email?: string | null
          parent_name?: string | null
          parent_user_id?: string | null
          privacy_version?: string | null
          relationship?: string
          requested_at?: string | null
          reverify_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          scope?: Json
          status?: string
          terms_version?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verification_token_hash?: string | null
        }
        Update: {
          approved_at?: string | null
          child_policy_version?: string | null
          child_user_id?: string
          created_at?: string
          id?: string
          jurisdiction?: string
          method?: string
          parent_email?: string | null
          parent_name?: string | null
          parent_user_id?: string | null
          privacy_version?: string | null
          relationship?: string
          requested_at?: string | null
          reverify_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          scope?: Json
          status?: string
          terms_version?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verification_token_hash?: string | null
        }
        Relationships: []
      }
      payment_submissions: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          dispute_reason: string | null
          disputed_at: string | null
          disputed_by: string | null
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
          cancellation_reason?: string | null
          cancelled_at?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
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
          cancellation_reason?: string | null
          cancelled_at?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
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
            foreignKeyName: "payment_submissions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "hosted_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "host_payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_verification_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_status: string | null
          game_id: string
          host_id: string
          id: string
          notes: string | null
          player_id: string
          submission_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          game_id: string
          host_id: string
          id?: string
          notes?: string | null
          player_id: string
          submission_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          game_id?: string
          host_id?: string
          id?: string
          notes?: string | null
          player_id?: string
          submission_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_verification_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      player_availabilities: {
        Row: {
          city: string | null
          created_at: string
          ends_on: string | null
          formatted_address: string | null
          hidden_at: string | null
          id: string
          lat: number | null
          lng: number | null
          note: string | null
          place_id: string | null
          recurring_days: string[]
          skill_level: string
          sports: string[]
          starts_on: string | null
          status: string
          time_slots: Json
          timezone: string | null
          travel_radius_km: number
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          ends_on?: string | null
          formatted_address?: string | null
          hidden_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          place_id?: string | null
          recurring_days?: string[]
          skill_level?: string
          sports?: string[]
          starts_on?: string | null
          status?: string
          time_slots?: Json
          timezone?: string | null
          travel_radius_km?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          ends_on?: string | null
          formatted_address?: string | null
          hidden_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          place_id?: string | null
          recurring_days?: string[]
          skill_level?: string
          sports?: string[]
          starts_on?: string | null
          status?: string
          time_slots?: Json
          timezone?: string | null
          travel_radius_km?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          hidden_at: string | null
          id: string
          subject_id: string
          subject_type: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          hidden_at?: string | null
          id?: string
          subject_id: string
          subject_type: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          hidden_at?: string | null
          id?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      post_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          subject_id: string
          subject_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          subject_id: string
          subject_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          subject_id?: string
          subject_type?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_preferences: {
        Row: {
          ai_disclosure_ack_at: string | null
          ai_processing: boolean
          ai_training_opt_in: boolean
          allow_invites: string
          allow_messages: string
          created_at: string
          location_precision: string
          marketing_emails: boolean
          profile_visibility: string
          show_games_played: boolean
          show_online_status: boolean
          show_sports: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_disclosure_ack_at?: string | null
          ai_processing?: boolean
          ai_training_opt_in?: boolean
          allow_invites?: string
          allow_messages?: string
          created_at?: string
          location_precision?: string
          marketing_emails?: boolean
          profile_visibility?: string
          show_games_played?: boolean
          show_online_status?: boolean
          show_sports?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_disclosure_ack_at?: string | null
          ai_processing?: boolean
          ai_training_opt_in?: boolean
          allow_invites?: string
          allow_messages?: string
          created_at?: string
          location_precision?: string
          marketing_emails?: boolean
          profile_visibility?: string
          show_games_played?: boolean
          show_online_status?: boolean
          show_sports?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_birthdays: {
        Row: {
          birthday: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_type: string | null
          active_profile_id: string | null
          age_category: string
          age_cohort: string
          age_review_required: boolean
          avatar_initials: string | null
          avatar_url: string | null
          avatar_url_private: string | null
          avatar_visibility: string
          bio: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          default_profile_id: string | null
          display_name: string
          graduating_class: number | null
          id: string
          jurisdiction: string
          links: Json
          moderation_state: string
          search_radius_mi: number | null
          sport: string | null
          sport_levels: Json
          suspended_at: string | null
          suspended_reason: string | null
          timezone: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          account_type?: string | null
          active_profile_id?: string | null
          age_category?: string
          age_cohort?: string
          age_review_required?: boolean
          avatar_initials?: string | null
          avatar_url?: string | null
          avatar_url_private?: string | null
          avatar_visibility?: string
          bio?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          default_profile_id?: string | null
          display_name?: string
          graduating_class?: number | null
          id: string
          jurisdiction?: string
          links?: Json
          moderation_state?: string
          search_radius_mi?: number | null
          sport?: string | null
          sport_levels?: Json
          suspended_at?: string | null
          suspended_reason?: string | null
          timezone?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          account_type?: string | null
          active_profile_id?: string | null
          age_category?: string
          age_cohort?: string
          age_review_required?: boolean
          avatar_initials?: string | null
          avatar_url?: string | null
          avatar_url_private?: string | null
          avatar_visibility?: string
          bio?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          default_profile_id?: string | null
          display_name?: string
          graduating_class?: number | null
          id?: string
          jurisdiction?: string
          links?: Json
          moderation_state?: string
          search_radius_mi?: number | null
          sport?: string | null
          sport_levels?: Json
          suspended_at?: string | null
          suspended_reason?: string | null
          timezone?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_profile_id_fkey"
            columns: ["default_profile_id"]
            isOneToOne: false
            referencedRelation: "account_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      scheduled_notifications: {
        Row: {
          attempts: number
          body: string | null
          channel: string
          created_at: string
          deliver_after: string
          id: string
          last_error: string | null
          reason: string
          sent_at: string | null
          status: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          channel?: string
          created_at?: string
          deliver_after: string
          id?: string
          last_error?: string | null
          reason?: string
          sent_at?: string | null
          status?: string
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          body?: string | null
          channel?: string
          created_at?: string
          deliver_after?: string
          id?: string
          last_error?: string | null
          reason?: string
          sent_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      session_activity: {
        Row: {
          created_at: string
          id: string
          last_heartbeat_at: string
          started_at: string
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_heartbeat_at?: string
          started_at?: string
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_heartbeat_at?: string
          started_at?: string
          timezone?: string | null
          updated_at?: string
          user_id?: string
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
      team_invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invitee_id: string
          message: string | null
          responded_at: string | null
          role: Database["public"]["Enums"]["team_role"]
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invitee_id: string
          message?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invitee_id?: string
          message?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          jersey_number: string | null
          position: string | null
          role: Database["public"]["Enums"]["team_role"]
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          jersey_number?: string | null
          position?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          jersey_number?: string | null
          position?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          event_date: string | null
          formatted_address: string | null
          hidden_at: string | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          location: string | null
          pinned: boolean
          place_id: string | null
          price: number | null
          spots_max: number | null
          spots_taken: number
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          event_date?: string | null
          formatted_address?: string | null
          hidden_at?: string | null
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          location?: string | null
          pinned?: boolean
          place_id?: string | null
          price?: number | null
          spots_max?: number | null
          spots_taken?: number
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          event_date?: string | null
          formatted_address?: string | null
          hidden_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          location?: string | null
          pinned?: boolean
          place_id?: string | null
          price?: number | null
          spots_max?: number | null
          spots_taken?: number
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_posts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          accent: string
          achievements: string[]
          availability_overrides: Json
          availability_rules: Json
          availability_slots: Json
          avatar: string
          bio: string
          cadence: string | null
          cadences: Json
          city: string
          cover: string
          created_at: string
          credentials: string[]
          distances: string[]
          followers: number
          format: string | null
          formats: Json
          founded: number | null
          handle: string
          hidden_at: string | null
          home_court: string | null
          id: string
          kind: string
          league: string | null
          losses: number
          name: string
          owner_id: string
          positions_needed: Json
          primary_venue: string | null
          rate_per_hour: number | null
          rating_max: string | null
          rating_min: string | null
          rating_system: string | null
          session_types: string[]
          skill_max: number
          skill_min: number
          sports: string[]
          staff: Json
          tagline: string
          timezone: string
          updated_at: string
          venue_addresses: Json
          venue_geo: Json
          venues: string[]
          verified: boolean
          wins: number
        }
        Insert: {
          accent?: string
          achievements?: string[]
          availability_overrides?: Json
          availability_rules?: Json
          availability_slots?: Json
          avatar?: string
          bio?: string
          cadence?: string | null
          cadences?: Json
          city?: string
          cover?: string
          created_at?: string
          credentials?: string[]
          distances?: string[]
          followers?: number
          format?: string | null
          formats?: Json
          founded?: number | null
          handle: string
          hidden_at?: string | null
          home_court?: string | null
          id: string
          kind: string
          league?: string | null
          losses?: number
          name: string
          owner_id: string
          positions_needed?: Json
          primary_venue?: string | null
          rate_per_hour?: number | null
          rating_max?: string | null
          rating_min?: string | null
          rating_system?: string | null
          session_types?: string[]
          skill_max?: number
          skill_min?: number
          sports?: string[]
          staff?: Json
          tagline?: string
          timezone?: string
          updated_at?: string
          venue_addresses?: Json
          venue_geo?: Json
          venues?: string[]
          verified?: boolean
          wins?: number
        }
        Update: {
          accent?: string
          achievements?: string[]
          availability_overrides?: Json
          availability_rules?: Json
          availability_slots?: Json
          avatar?: string
          bio?: string
          cadence?: string | null
          cadences?: Json
          city?: string
          cover?: string
          created_at?: string
          credentials?: string[]
          distances?: string[]
          followers?: number
          format?: string | null
          formats?: Json
          founded?: number | null
          handle?: string
          hidden_at?: string | null
          home_court?: string | null
          id?: string
          kind?: string
          league?: string | null
          losses?: number
          name?: string
          owner_id?: string
          positions_needed?: Json
          primary_venue?: string | null
          rate_per_hour?: number | null
          rating_max?: string | null
          rating_min?: string | null
          rating_system?: string | null
          session_types?: string[]
          skill_max?: number
          skill_min?: number
          sports?: string[]
          staff?: Json
          tagline?: string
          timezone?: string
          updated_at?: string
          venue_addresses?: Json
          venue_geo?: Json
          venues?: string[]
          verified?: boolean
          wins?: number
        }
        Relationships: []
      }
      trainer_org_invites: {
        Row: {
          created_at: string
          id: string
          invited_by: string
          invited_trainer_id: string
          invited_user_id: string
          message: string | null
          org_id: string
          responded_at: string | null
          role: Database["public"]["Enums"]["trainer_org_role"]
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by: string
          invited_trainer_id: string
          invited_user_id: string
          message?: string | null
          org_id: string
          responded_at?: string | null
          role?: Database["public"]["Enums"]["trainer_org_role"]
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string
          invited_trainer_id?: string
          invited_user_id?: string
          message?: string | null
          org_id?: string
          responded_at?: string | null
          role?: Database["public"]["Enums"]["trainer_org_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_org_invites_invited_trainer_id_fkey"
            columns: ["invited_trainer_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_org_join_requests: {
        Row: {
          created_at: string
          id: string
          message: string | null
          org_id: string
          requested_by: string
          reviewed_at: string | null
          reviewer_notes: string | null
          status: string
          trainer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          org_id: string
          requested_by: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: string
          trainer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          org_id?: string
          requested_by?: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_org_join_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_org_join_requests_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_org_members: {
        Row: {
          id: string
          joined_at: string
          org_id: string
          role: Database["public"]["Enums"]["trainer_org_role"]
          trainer_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["trainer_org_role"]
          trainer_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["trainer_org_role"]
          trainer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "trainer_orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_org_members_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_orgs: {
        Row: {
          address: string | null
          amenities: string[]
          avatar: string | null
          avatar_url: string | null
          bio: string | null
          category: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          email: string | null
          geo: Json | null
          handle: string
          hidden_at: string | null
          hours: Json
          id: string
          name: string
          owner_id: string
          phone: string | null
          photos: string[]
          place_id: string | null
          timezone: string | null
          updated_at: string
          verified: boolean
          website: string | null
        }
        Insert: {
          address?: string | null
          amenities?: string[]
          avatar?: string | null
          avatar_url?: string | null
          bio?: string | null
          category?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          email?: string | null
          geo?: Json | null
          handle: string
          hidden_at?: string | null
          hours?: Json
          id?: string
          name: string
          owner_id: string
          phone?: string | null
          photos?: string[]
          place_id?: string | null
          timezone?: string | null
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Update: {
          address?: string | null
          amenities?: string[]
          avatar?: string | null
          avatar_url?: string | null
          bio?: string | null
          category?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          email?: string | null
          geo?: Json | null
          handle?: string
          hidden_at?: string | null
          hours?: Json
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          photos?: string[]
          place_id?: string | null
          timezone?: string | null
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Relationships: []
      }
      trainer_session_requests: {
        Row: {
          created_at: string
          duration_minutes: number
          from_user_id: string
          id: string
          message: string | null
          preferred_date: string | null
          preferred_start_time: string | null
          responder_note: string | null
          session_type: string
          status: string
          to_user_id: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          from_user_id: string
          id?: string
          message?: string | null
          preferred_date?: string | null
          preferred_start_time?: string | null
          responder_note?: string | null
          session_type?: string
          status?: string
          to_user_id: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          from_user_id?: string
          id?: string
          message?: string | null
          preferred_date?: string | null
          preferred_start_time?: string | null
          responder_note?: string | null
          session_type?: string
          status?: string
          to_user_id?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_session_requests_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          conversation_id: string | null
          created_at: string
          details: string | null
          game_id: string | null
          id: string
          message_id: string | null
          reason: string
          reel_id: string | null
          reported_id: string
          reporter_id: string
          resolution_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          subject_type: string
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          game_id?: string | null
          id?: string
          message_id?: string | null
          reason: string
          reel_id?: string | null
          reported_id: string
          reporter_id: string
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subject_type?: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          game_id?: string | null
          id?: string
          message_id?: string | null
          reason?: string
          reel_id?: string | null
          reported_id?: string
          reporter_id?: string
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subject_type?: string
          updated_at?: string
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
      accept_conversation: { Args: { _conv: string }; Returns: undefined }
      accept_trainer_org_invite: { Args: { _invite: string }; Returns: string }
      admin_audit_log_facets: {
        Args: never
        Returns: {
          kind: string
          label: string
          uses: number
          value: string
        }[]
      }
      admin_list_storage_objects: {
        Args: {
          _buckets: string[]
          _limit?: number
          _offset?: number
          _search?: string
          _status?: string
        }
        Returns: {
          bucket_id: string
          created_at: string
          mimetype: string
          name: string
          owner: string
          reason: string
          reviewed_at: string
          size: number
          status: string
          total: number
        }[]
      }
      age_category_from_birthday: { Args: { _bd: string }; Returns: string }
      age_cohort_from_birthday: { Args: { _bd: string }; Returns: string }
      age_cohort_of: { Args: { _user: string }; Returns: string }
      age_cohort_rank: { Args: { _cohort: string }; Returns: number }
      age_policy_flag: {
        Args: { _fallback: boolean; _key: string }
        Returns: boolean
      }
      age_policy_number: {
        Args: { _fallback: number; _key: string }
        Returns: number
      }
      age_verified: { Args: { _user: string }; Returns: boolean }
      approve_org_member_request: { Args: { _req: string }; Returns: string }
      approve_parental_consent: {
        Args: {
          _method: string
          _parent_user: string
          _token_hash: string
          _versions?: Json
        }
        Returns: string
      }
      approve_trainer_org_join: { Args: { _req: string }; Returns: string }
      blocked_image_paths: {
        Args: never
        Returns: {
          bucket: string
          path: string
        }[]
      }
      blocks_exist_between: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      calculate_age: { Args: { _dob: string; _now?: string }; Returns: number }
      can_notify: {
        Args: { _caller: string; _target: string }
        Returns: boolean
      }
      child_features_locked: { Args: { _user: string }; Returns: boolean }
      child_game_participation_allowed: {
        Args: { _user: string }
        Returns: boolean
      }
      clear_age_review: {
        Args: { _approve: boolean; _user: string }
        Returns: undefined
      }
      create_direct_conversation: {
        Args: { _game_id?: string; _other_user: string }
        Returns: string
      }
      create_minor_invite: {
        Args: {
          _child_name: string
          _expires_at: string
          _relationship: string
          _token_hash: string
        }
        Returns: string
      }
      create_parent_request: {
        Args: { _child: string; _details: string; _kind: string }
        Returns: string
      }
      create_trainer_org_with_owner:
        | {
            Args: {
              _avatar?: string
              _bio?: string
              _city?: string
              _handle: string
              _name: string
              _trainer_id: string
              _website?: string
            }
            Returns: string
          }
        | {
            Args: {
              _address?: string
              _avatar?: string
              _bio?: string
              _city?: string
              _geo?: Json
              _handle: string
              _name: string
              _place_id?: string
              _trainer_id: string
              _website?: string
            }
            Returns: string
          }
      decline_conversation: { Args: { _conv: string }; Returns: undefined }
      default_profile_visibility_for: {
        Args: { _user: string }
        Returns: string
      }
      deny_org_member_request: {
        Args: { _reason: string; _req: string }
        Returns: undefined
      }
      expire_stale_data_exports: { Args: never; Returns: number }
      free_reels_used: {
        Args: { check_env?: string; user_uuid: string }
        Returns: number
      }
      game_payments_allowed: { Args: { _user: string }; Returns: boolean }
      get_account_type: { Args: { _user_id: string }; Returns: string }
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
      get_my_birthday: { Args: never; Returns: string }
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
      has_verified_gym_visit: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      host_attendance_stats: {
        Args: { _host: string }
        Returns: {
          attended: number
          cancelled_games: number
          completed_games: number
          marked: number
        }[]
      }
      host_cancel_game: {
        Args: { _game_id: string; _reason: string }
        Returns: undefined
      }
      host_complete_game: { Args: { _game_id: string }; Returns: undefined }
      host_mark_attendance: {
        Args: { _attended: boolean; _game_id: string; _user_id: string }
        Returns: undefined
      }
      is_conversation_participant: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_game_participant: {
        Args: { _game_id: string; _user_id: string }
        Returns: boolean
      }
      is_guardian_of: {
        Args: { _child: string; _parent: string }
        Returns: boolean
      }
      is_gym_admin_text: {
        Args: { _reviewee_id: string; _user: string }
        Returns: boolean
      }
      is_minor: { Args: { _user: string }; Returns: boolean }
      is_moderator: { Args: { _user_id: string }; Returns: boolean }
      is_org_member: { Args: { _org: string; _user: string }; Returns: boolean }
      is_superadmin: { Args: { _user_id: string }; Returns: boolean }
      is_team_manager: {
        Args: { _team: string; _user: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team: string; _user: string }
        Returns: boolean
      }
      is_trainer_org_admin: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      is_trainer_org_member: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      legal_consent_stats: {
        Args: never
        Returns: {
          accepted_count: number
          document_type: string
          document_version: string
          latest_accepted_at: string
        }[]
      }
      legal_reacceptance_pending: {
        Args: { _document_type: string; _version: string }
        Returns: number
      }
      list_birthday_corrections: {
        Args: { _status?: string }
        Returns: {
          created_at: string
          current_birthday: string
          display_name: string
          evidence: string
          handle: string
          id: string
          reason: string
          requested_birthday: string
          review_notes: string
          reviewed_at: string
          status: string
          user_id: string
        }[]
      }
      list_trainer_booked_slots: {
        Args: { _date: string; _trainer_id: string }
        Returns: {
          end_time: string
          start_time: string
          status: string
        }[]
      }
      lookup_minor_invite: {
        Args: { _token_hash: string }
        Returns: {
          child_name: string
          expires_at: string
          parent_name: string
          relationship: string
          state: string
        }[]
      }
      minor_handle_unsafe: {
        Args: { _cohort: string; _handle: string }
        Returns: boolean
      }
      minor_messaging_allowed: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      minor_time_on_platform: {
        Args: { _days?: number }
        Returns: {
          avg_daily_minutes: number
          cohort: string
          day_part: string
          members: number
        }[]
      }
      moderate_gym_review: {
        Args: { _hidden: boolean; _review_id: string }
        Returns: undefined
      }
      my_age_category: { Args: never; Returns: string }
      my_age_cohort: { Args: never; Returns: string }
      my_birthday_corrections: {
        Args: never
        Returns: {
          created_at: string
          id: string
          reason: string
          requested_birthday: string
          review_notes: string
          reviewed_at: string
          status: string
        }[]
      }
      my_platform_status: {
        Args: never
        Returns: {
          age_category: string
          birthday_set: boolean
          cohort: string
          review_required: boolean
          status: string
        }[]
      }
      notify_guardians: {
        Args: {
          _body: string
          _child: string
          _link: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      parental_consent_required: { Args: { _cohort: string }; Returns: boolean }
      parental_consent_state: { Args: { _child: string }; Returns: string }
      platform_status: { Args: { _user: string }; Returns: string }
      player_activity_stats: {
        Args: { _user: string }
        Returns: {
          first_activity_at: string
          games_attended: number
          games_completed: number
          games_joined: number
          hosted_cancelled: number
          hosted_completed: number
          hosted_total: number
          no_shows: number
          review_avg: number
          review_count: number
          teams_count: number
          verified_review_count: number
        }[]
      }
      privacy_text: { Args: { _key: string; _user: string }; Returns: string }
      profile_ages: {
        Args: { _ids: string[] }
        Returns: {
          age: number
          id: string
        }[]
      }
      profile_visibility_of: { Args: { _user: string }; Returns: string }
      public_privacy_flags: {
        Args: { _ids: string[] }
        Returns: {
          show_games_played: boolean
          show_sports: boolean
          user_id: string
        }[]
      }
      publish_legal_document: { Args: { _id: string }; Returns: string }
      record_session_heartbeat: {
        Args: { _timezone?: string }
        Returns: string
      }
      redeem_minor_invite: {
        Args: { _token_hash: string }
        Returns: {
          consent_recorded: boolean
          parent_id: string
        }[]
      }
      reel_audience: { Args: { _reel_id: string }; Returns: string }
      reel_publicly_visible: { Args: { _reel_id: string }; Returns: boolean }
      request_birthday_correction: {
        Args: { _evidence?: string; _reason: string; _requested: string }
        Returns: string
      }
      request_parental_consent: {
        Args: {
          _jurisdiction: string
          _parent_email: string
          _parent_name: string
          _relationship: string
          _token_expires_at: string
          _token_hash: string
          _versions: Json
        }
        Returns: string
      }
      review_birthday_correction: {
        Args: { _approve: boolean; _id: string; _notes?: string }
        Returns: undefined
      }
      revoke_minor_invite: { Args: { _id: string }; Returns: undefined }
      revoke_parental_consent: {
        Args: { _child: string; _reason: string }
        Returns: undefined
      }
      set_child_controls: {
        Args: { _child: string; _controls: Json }
        Returns: undefined
      }
      set_my_birthday: {
        Args: { _dob: string }
        Returns: {
          cohort: string
          member_age: number
          review_required: boolean
          status: string
        }[]
      }
      shares_game_or_chat: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      team_cancel_invite: { Args: { _invite: string }; Returns: undefined }
      team_invite_player: {
        Args: {
          _message?: string
          _role?: Database["public"]["Enums"]["team_role"]
          _team: string
          _user: string
        }
        Returns: string
      }
      team_owner_of: { Args: { _team: string }; Returns: string }
      team_remove_member: {
        Args: { _team: string; _user: string }
        Returns: undefined
      }
      team_respond_invite: {
        Args: { _accept: boolean; _invite: string }
        Returns: string
      }
      team_role_of: {
        Args: { _team: string; _user: string }
        Returns: Database["public"]["Enums"]["team_role"]
      }
      team_set_member_role: {
        Args: {
          _role: Database["public"]["Enums"]["team_role"]
          _team: string
          _user: string
        }
        Returns: undefined
      }
      try_uuid: { Args: { _v: string }; Returns: string }
      unpublish_legal_document: {
        Args: { _id: string; _reason?: string }
        Returns: string
      }
      unsend_message: { Args: { _id: string }; Returns: undefined }
      visible_avatars: {
        Args: { _ids: string[] }
        Returns: {
          avatar_hidden: boolean
          avatar_initials: string
          avatar_url: string
          avatar_visibility: string
          display_name: string
          id: string
        }[]
      }
      youth_flag: { Args: { _flag: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "superadmin"
      team_role: "owner" | "manager" | "coach" | "captain" | "player"
      trainer_org_role: "owner" | "admin" | "member"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "superadmin"],
      team_role: ["owner", "manager", "coach", "captain", "player"],
      trainer_org_role: ["owner", "admin", "member"],
    },
  },
} as const
