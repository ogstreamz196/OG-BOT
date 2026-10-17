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
      ai_key_failures: {
        Row: {
          alerted_at: string | null
          created_at: string
          id: number
          key_name: string
          status: number
        }
        Insert: {
          alerted_at?: string | null
          created_at?: string
          id?: never
          key_name: string
          status: number
        }
        Update: {
          alerted_at?: string | null
          created_at?: string
          id?: never
          key_name?: string
          status?: number
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number
          created_at: string
          feature: string
          id: string
          model: string | null
          prompt_tokens: number
          provider: string
          total_tokens: number
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          feature: string
          id?: string
          model?: string | null
          prompt_tokens?: number
          provider: string
          total_tokens?: number
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          feature?: string
          id?: string
          model?: string | null
          prompt_tokens?: number
          provider?: string
          total_tokens?: number
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      battle_lexicon: {
        Row: {
          first_seen: string
          last_seen: string
          uses: number
          word: string
        }
        Insert: {
          first_seen?: string
          last_seen?: string
          uses?: number
          word: string
        }
        Update: {
          first_seen?: string
          last_seen?: string
          uses?: number
          word?: string
        }
        Relationships: []
      }
      battle_tallies: {
        Row: {
          last_battle_date: string | null
          pending_tenths: number
          rounds: number
          streak_bonus_date: string | null
          streak_days: number
          total_awarded_coins: number
          updated_at: string
          user_id: string
        }
        Insert: {
          last_battle_date?: string | null
          pending_tenths?: number
          rounds?: number
          streak_bonus_date?: string | null
          streak_days?: number
          total_awarded_coins?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          last_battle_date?: string | null
          pending_tenths?: number
          rounds?: number
          streak_bonus_date?: string | null
          streak_days?: number
          total_awarded_coins?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      boss_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          category: string
          created_at: string
          id: string
          metadata: Json
          new_value: string | null
          old_value: string | null
          target_key: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          category: string
          created_at?: string
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          target_key: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          category?: string
          created_at?: string
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          target_key?: string
        }
        Relationships: []
      }
      boss_notification_prefs: {
        Row: {
          notify_every_signin: boolean
          notify_new_country: boolean
          notify_new_device: boolean
          notify_on_signup: boolean
          notify_suspicious: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          sheets_sync_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          notify_every_signin?: boolean
          notify_new_country?: boolean
          notify_new_device?: boolean
          notify_on_signup?: boolean
          notify_suspicious?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sheets_sync_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          notify_every_signin?: boolean
          notify_new_country?: boolean
          notify_new_device?: boolean
          notify_on_signup?: boolean
          notify_suspicious?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sheets_sync_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      boss_presence_alerts: {
        Row: {
          kind: string
          last_sent_at: string
          user_id: string
        }
        Insert: {
          kind: string
          last_sent_at?: string
          user_id: string
        }
        Update: {
          kind?: string
          last_sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_catchphrase_seen: {
        Row: {
          phrase_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          phrase_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          phrase_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_catchphrase_seen_phrase_id_fkey"
            columns: ["phrase_id"]
            isOneToOne: false
            referencedRelation: "bot_catchphrases"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_catchphrases: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          kind: string
          phrase: string
          source: string
          times_used: number
          tone: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          phrase: string
          source?: string
          times_used?: number
          tone: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          phrase?: string
          source?: string
          times_used?: number
          tone?: string
        }
        Relationships: []
      }
      bot_tokens: {
        Row: {
          allowed_domain: string | null
          created_at: string
          developer_id: string
          id: string
          status: string
          token_string: string
          updated_at: string
        }
        Insert: {
          allowed_domain?: string | null
          created_at?: string
          developer_id: string
          id?: string
          status?: string
          token_string?: string
          updated_at?: string
        }
        Update: {
          allowed_domain?: string | null
          created_at?: string
          developer_id?: string
          id?: string
          status?: string
          token_string?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_tokens_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_image_allowance: {
        Row: {
          last_free_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          last_free_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          last_free_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coin_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          reference: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          reference?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reference?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      community_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      community_history_clears: {
        Row: {
          cleared_at: string
          user_id: string
        }
        Insert: {
          cleared_at?: string
          user_id: string
        }
        Update: {
          cleared_at?: string
          user_id?: string
        }
        Relationships: []
      }
      community_messages: {
        Row: {
          content: string
          created_at: string
          display_name: string | null
          guest_id: string | null
          id: string
          role: string
          score_tenths: number | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          role: string
          score_tenths?: number | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          role?: string
          score_tenths?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      community_reports: {
        Row: {
          created_at: string
          id: string
          message_id: string
          reason: string
          reported_user_id: string | null
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          reason?: string
          reported_user_id?: string | null
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          reason?: string
          reported_user_id?: string | null
          reporter_id?: string
        }
        Relationships: []
      }
      daily_drops: {
        Row: {
          coins: number
          created_at: string
          drop_date: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          coins: number
          created_at?: string
          drop_date?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          coins?: number
          created_at?: string
          drop_date?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      device_accounts: {
        Row: {
          created_at: string
          device_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      generation_attempts: {
        Row: {
          context: Json
          created_at: string
          error_message: string | null
          id: string
          song_id: string | null
          stage: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          song_id?: string | null
          stage?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          song_id?: string | null
          stage?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      guest_battle_claims: {
        Row: {
          claimed_at: string
          credited_tenths: number
          guest_id: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          credited_tenths?: number
          guest_id: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          credited_tenths?: number
          guest_id?: string
          user_id?: string
        }
        Relationships: []
      }
      ledgerly_settings: {
        Row: {
          api_key: string | null
          enabled: boolean
          id: number
          key_name: string | null
          last_error: string | null
          last_sync_at: string | null
          last_test_at: string | null
          last_test_ok: boolean | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          enabled?: boolean
          id?: number
          key_name?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_test_at?: string | null
          last_test_ok?: boolean | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          enabled?: boolean
          id?: number
          key_name?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_test_at?: string | null
          last_test_ok?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      og_bot_remote_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          external_user: string | null
          grants_vip: boolean
          id: string
          origin_host: string
          revoked_at: string | null
          signing_secret: string | null
          token: string
          uses_remaining: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          external_user?: string | null
          grants_vip?: boolean
          id?: string
          origin_host: string
          revoked_at?: string | null
          signing_secret?: string | null
          token: string
          uses_remaining?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          external_user?: string | null
          grants_vip?: boolean
          id?: string
          origin_host?: string
          revoked_at?: string | null
          signing_secret?: string | null
          token?: string
          uses_remaining?: number | null
        }
        Relationships: []
      }
      og_bot_token_invites: {
        Row: {
          claim_expires_at: string | null
          code: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          revoked_at: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          claim_expires_at?: string | null
          code: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          revoked_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          claim_expires_at?: string | null
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          revoked_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      og_bot_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          last_used_at: string | null
          revoked_at: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      og_learned_insults: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          phrase: string
          user_id: string
          uses: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          phrase: string
          user_id: string
          uses?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          phrase?: string
          user_id?: string
          uses?: number
        }
        Relationships: []
      }
      og_lexicon: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          notes: string | null
          phrase: string
          severity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          notes?: string | null
          phrase: string
          severity?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          notes?: string | null
          phrase?: string
          severity?: number
          updated_at?: string
        }
        Relationships: []
      }
      og_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_refunds: {
        Row: {
          amount: number
          created_at: string
          currency: string
          environment: string
          failure_reason: string | null
          id: string
          reason: string | null
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string
          stripe_session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          environment?: string
          failure_reason?: string | null
          id?: string
          reason?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          environment?: string
          failure_reason?: string | null
          id?: string
          reason?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      portals: {
        Row: {
          allowed_styles: string[] | null
          coin_cost_per_generation: number
          created_at: string
          created_by: string | null
          custom_welcome_text: string | null
          id: string
          language: string
          name: string
          primary_color: string
          slug: string
          status: string
          style_tags: string[]
          updated_at: string
        }
        Insert: {
          allowed_styles?: string[] | null
          coin_cost_per_generation?: number
          created_at?: string
          created_by?: string | null
          custom_welcome_text?: string | null
          id?: string
          language: string
          name: string
          primary_color?: string
          slug: string
          status?: string
          style_tags?: string[]
          updated_at?: string
        }
        Update: {
          allowed_styles?: string[] | null
          coin_cost_per_generation?: number
          created_at?: string
          created_by?: string | null
          custom_welcome_text?: string | null
          id?: string
          language?: string
          name?: string
          primary_color?: string
          slug?: string
          status?: string
          style_tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          artist_bio: string | null
          boss_notified_at: string | null
          coin_balance: number
          created_at: string
          custom_bot_name: string
          display_name: string | null
          email: string | null
          gps_consent: boolean
          gps_consent_at: string | null
          id: string
          last_activity_at: string | null
          last_city: string | null
          last_country: string | null
          last_device: string | null
          last_ip: string | null
          last_label: string | null
          last_page: string | null
          last_page_at: string | null
          last_path: string | null
          last_sign_in_at: string | null
          og_vip_id: string | null
          referral_code: string | null
          sign_in_count: number
          telegram_chat_id: number | null
          telegram_link_token: string | null
          telegram_linked_at: string | null
          telegram_username: string | null
          total_bot_interactions: number
          updated_at: string
          vip_name_confirmed_at: string | null
          vip_trial_ends_at: string | null
          vip_trial_started_at: string | null
          widget_deployed_domains: string[]
        }
        Insert: {
          artist_bio?: string | null
          boss_notified_at?: string | null
          coin_balance?: number
          created_at?: string
          custom_bot_name?: string
          display_name?: string | null
          email?: string | null
          gps_consent?: boolean
          gps_consent_at?: string | null
          id: string
          last_activity_at?: string | null
          last_city?: string | null
          last_country?: string | null
          last_device?: string | null
          last_ip?: string | null
          last_label?: string | null
          last_page?: string | null
          last_page_at?: string | null
          last_path?: string | null
          last_sign_in_at?: string | null
          og_vip_id?: string | null
          referral_code?: string | null
          sign_in_count?: number
          telegram_chat_id?: number | null
          telegram_link_token?: string | null
          telegram_linked_at?: string | null
          telegram_username?: string | null
          total_bot_interactions?: number
          updated_at?: string
          vip_name_confirmed_at?: string | null
          vip_trial_ends_at?: string | null
          vip_trial_started_at?: string | null
          widget_deployed_domains?: string[]
        }
        Update: {
          artist_bio?: string | null
          boss_notified_at?: string | null
          coin_balance?: number
          created_at?: string
          custom_bot_name?: string
          display_name?: string | null
          email?: string | null
          gps_consent?: boolean
          gps_consent_at?: string | null
          id?: string
          last_activity_at?: string | null
          last_city?: string | null
          last_country?: string | null
          last_device?: string | null
          last_ip?: string | null
          last_label?: string | null
          last_page?: string | null
          last_page_at?: string | null
          last_path?: string | null
          last_sign_in_at?: string | null
          og_vip_id?: string | null
          referral_code?: string | null
          sign_in_count?: number
          telegram_chat_id?: number | null
          telegram_link_token?: string | null
          telegram_linked_at?: string | null
          telegram_username?: string | null
          total_bot_interactions?: number
          updated_at?: string
          vip_name_confirmed_at?: string | null
          vip_trial_ends_at?: string | null
          vip_trial_started_at?: string | null
          widget_deployed_domains?: string[]
        }
        Relationships: []
      }
      referral_cashback_accrual: {
        Row: {
          pending_hundredths: number
          referrer_id: string
          updated_at: string
        }
        Insert: {
          pending_hundredths?: number
          referrer_id: string
          updated_at?: string
        }
        Update: {
          pending_hundredths?: number
          referrer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_cashback_accrual_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          referee_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          referee_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          referee_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          actor_id: string | null
          coin_delta: number | null
          created_at: string
          event_type: string
          id: string
          jwt_role: string | null
          metadata: Json | null
          new_balance: number | null
          old_balance: number | null
          reason: string | null
          request_ip: string | null
          song_id: string | null
          target_user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          coin_delta?: number | null
          created_at?: string
          event_type: string
          id?: string
          jwt_role?: string | null
          metadata?: Json | null
          new_balance?: number | null
          old_balance?: number | null
          reason?: string | null
          request_ip?: string | null
          song_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          coin_delta?: number | null
          created_at?: string
          event_type?: string
          id?: string
          jwt_role?: string | null
          metadata?: Json | null
          new_balance?: number | null
          old_balance?: number | null
          reason?: string | null
          request_ip?: string | null
          song_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      sign_in_events: {
        Row: {
          browser: string | null
          city: string | null
          country: string | null
          created_at: string
          device_type: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          ip: string | null
          is_new_country: boolean
          is_new_device: boolean
          is_signup: boolean
          landing_path: string | null
          lat: number | null
          lng: number | null
          os: string | null
          referrer: string | null
          region: string | null
          ua_raw: string | null
          user_id: string
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          ip?: string | null
          is_new_country?: boolean
          is_new_device?: boolean
          is_signup?: boolean
          landing_path?: string | null
          lat?: number | null
          lng?: number | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          ua_raw?: string | null
          user_id: string
        }
        Update: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          ip?: string | null
          is_new_country?: boolean
          is_new_device?: boolean
          is_signup?: boolean
          landing_path?: string | null
          lat?: number | null
          lng?: number | null
          os?: string | null
          referrer?: string | null
          region?: string | null
          ua_raw?: string | null
          user_id?: string
        }
        Relationships: []
      }
      site_content: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      song_brief_drafts: {
        Row: {
          created_at: string
          id: string
          improved_text: string
          original_text: string
          subject_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          improved_text: string
          original_text: string
          subject_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          improved_text?: string
          original_text?: string
          subject_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      songs: {
        Row: {
          audio_path: string | null
          beat_path: string | null
          completed_at: string | null
          cover_url: string | null
          created_at: string
          drive_archived_at: string | null
          drive_audio_id: string | null
          drive_audio_link: string | null
          drive_lyrics_id: string | null
          drive_lyrics_link: string | null
          duration_seconds: number | null
          error_message: string | null
          extra_context: string | null
          failure_class: string | null
          foul_intensity: number
          foul_mouth: boolean
          generation_started_at: string | null
          id: string
          is_public: boolean
          is_variation: boolean
          last_auto_retry_at: string | null
          lyric_video_error: string | null
          lyric_video_full_path: string | null
          lyric_video_preview_path: string | null
          lyric_video_progress: number
          lyric_video_rendered_at: string | null
          lyric_video_stage: string | null
          lyric_video_status: string
          lyric_video_unlocked: boolean
          lyrics: string | null
          lyrics_progress: number | null
          lyrics_stage: string | null
          lyrics_started_at: string | null
          next_retry_at: string | null
          orchestration: Json | null
          orchestration_attempts: number
          orchestration_due_at: string | null
          portal_id: string | null
          prompt: string
          retry_count: number
          retry_payload: Json | null
          revealed: boolean
          sample_path: string | null
          status: string
          stream_audio_url: string | null
          style: string | null
          suno_clip_id: string | null
          suno_task_id: string | null
          target_duration_sec: number | null
          title: string | null
          unlocked: boolean
          unlocked_at: string | null
          updated_at: string
          user_id: string
          vocals_only: boolean
        }
        Insert: {
          audio_path?: string | null
          beat_path?: string | null
          completed_at?: string | null
          cover_url?: string | null
          created_at?: string
          drive_archived_at?: string | null
          drive_audio_id?: string | null
          drive_audio_link?: string | null
          drive_lyrics_id?: string | null
          drive_lyrics_link?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          extra_context?: string | null
          failure_class?: string | null
          foul_intensity?: number
          foul_mouth?: boolean
          generation_started_at?: string | null
          id?: string
          is_public?: boolean
          is_variation?: boolean
          last_auto_retry_at?: string | null
          lyric_video_error?: string | null
          lyric_video_full_path?: string | null
          lyric_video_preview_path?: string | null
          lyric_video_progress?: number
          lyric_video_rendered_at?: string | null
          lyric_video_stage?: string | null
          lyric_video_status?: string
          lyric_video_unlocked?: boolean
          lyrics?: string | null
          lyrics_progress?: number | null
          lyrics_stage?: string | null
          lyrics_started_at?: string | null
          next_retry_at?: string | null
          orchestration?: Json | null
          orchestration_attempts?: number
          orchestration_due_at?: string | null
          portal_id?: string | null
          prompt: string
          retry_count?: number
          retry_payload?: Json | null
          revealed?: boolean
          sample_path?: string | null
          status?: string
          stream_audio_url?: string | null
          style?: string | null
          suno_clip_id?: string | null
          suno_task_id?: string | null
          target_duration_sec?: number | null
          title?: string | null
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string
          user_id: string
          vocals_only?: boolean
        }
        Update: {
          audio_path?: string | null
          beat_path?: string | null
          completed_at?: string | null
          cover_url?: string | null
          created_at?: string
          drive_archived_at?: string | null
          drive_audio_id?: string | null
          drive_audio_link?: string | null
          drive_lyrics_id?: string | null
          drive_lyrics_link?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          extra_context?: string | null
          failure_class?: string | null
          foul_intensity?: number
          foul_mouth?: boolean
          generation_started_at?: string | null
          id?: string
          is_public?: boolean
          is_variation?: boolean
          last_auto_retry_at?: string | null
          lyric_video_error?: string | null
          lyric_video_full_path?: string | null
          lyric_video_preview_path?: string | null
          lyric_video_progress?: number
          lyric_video_rendered_at?: string | null
          lyric_video_stage?: string | null
          lyric_video_status?: string
          lyric_video_unlocked?: boolean
          lyrics?: string | null
          lyrics_progress?: number | null
          lyrics_stage?: string | null
          lyrics_started_at?: string | null
          next_retry_at?: string | null
          orchestration?: Json | null
          orchestration_attempts?: number
          orchestration_due_at?: string | null
          portal_id?: string | null
          prompt?: string
          retry_count?: number
          retry_payload?: Json | null
          revealed?: boolean
          sample_path?: string | null
          status?: string
          stream_audio_url?: string | null
          style?: string | null
          suno_clip_id?: string | null
          suno_task_id?: string | null
          target_duration_sec?: number | null
          title?: string | null
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string
          user_id?: string
          vocals_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "songs_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "portals"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_guide_access: {
        Row: {
          coin_cost: number
          created_at: string
          id: string
          invite_expires_at: string | null
          invite_sent_at: string | null
          joined_at: string | null
          revoked_at: string | null
          status: string
          store_item_id: string
          telegram_invite_link: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          coin_cost: number
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invite_sent_at?: string | null
          joined_at?: string | null
          revoked_at?: string | null
          status?: string
          store_item_id: string
          telegram_invite_link?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          coin_cost?: number
          created_at?: string
          id?: string
          invite_expires_at?: string | null
          invite_sent_at?: string | null
          joined_at?: string | null
          revoked_at?: string | null
          status?: string
          store_item_id?: string
          telegram_invite_link?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_guide_access_store_item_id_fkey"
            columns: ["store_item_id"]
            isOneToOne: false
            referencedRelation: "store_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_guide_posts: {
        Row: {
          chat_id: number
          created_at: string
          event_time: string | null
          id: string
          posted_at: string
          raw_text: string
          sport_category: string
          telegram_message_id: number
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          event_time?: string | null
          id?: string
          posted_at?: string
          raw_text: string
          sport_category?: string
          telegram_message_id: number
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          event_time?: string | null
          id?: string
          posted_at?: string
          raw_text?: string
          sport_category?: string
          telegram_message_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      sports_guide_reminders: {
        Row: {
          created_at: string
          id: string
          post_id: string
          remind_at: string
          sent_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          remind_at: string
          sent_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          remind_at?: string
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_guide_reminders_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "sports_guide_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      store_categories: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          label: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      store_items: {
        Row: {
          active: boolean
          category_id: string
          coin_price: number | null
          coin_reward: number | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          perk_slug: string | null
          price_cents: number
          rarity: string
          recurring_interval: string | null
          slug: string
          sort_order: number
          stock: number | null
          stock_sold: number
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          coin_price?: number | null
          coin_reward?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          perk_slug?: string | null
          price_cents: number
          rarity?: string
          recurring_interval?: string | null
          slug: string
          sort_order?: number
          stock?: number | null
          stock_sold?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          coin_price?: number | null
          coin_reward?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          perk_slug?: string | null
          price_cents?: number
          rarity?: string
          recurring_interval?: string | null
          slug?: string
          sort_order?: number
          stock?: number | null
          stock_sold?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "store_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          environment: string
          event_id: string
          event_type: string
          payload_summary: Json | null
          received_at: string
        }
        Insert: {
          environment: string
          event_id: string
          event_type: string
          payload_summary?: Json | null
          received_at?: string
        }
        Update: {
          environment?: string
          event_id?: string
          event_type?: string
          payload_summary?: Json | null
          received_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_dm_queue: {
        Row: {
          attempts: number
          body: string
          created_at: string
          id: string
          last_error: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          target_user_id: string
          telegram_message_id: number | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          id?: string
          last_error?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          target_user_id: string
          telegram_message_id?: number | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          id?: string
          last_error?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          target_user_id?: string
          telegram_message_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_dm_queue_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_ephemeral_messages: {
        Row: {
          chat_id: number
          created_at: string
          delete_at: string
          id: string
          message_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          delete_at: string
          id?: string
          message_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          delete_at?: string
          id?: string
          message_id?: number
        }
        Relationships: []
      }
      telegram_processed_updates: {
        Row: {
          chat_id: number | null
          created_at: string
          kind: string | null
          update_id: number
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          kind?: string | null
          update_id: number
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          kind?: string | null
          update_id?: number
        }
        Relationships: []
      }
      telegram_sign_in_events: {
        Row: {
          chat_id: number | null
          created_at: string
          event_kind: string
          id: string
          source: string | null
          telegram_first_name: string | null
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          event_kind?: string
          id?: string
          source?: string | null
          telegram_first_name?: string | null
          telegram_username?: string | null
          user_id: string
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          event_kind?: string
          id?: string
          source?: string | null
          telegram_first_name?: string | null
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tiktok_renders: {
        Row: {
          created_at: string
          drive_file_id: string | null
          drive_url: string | null
          error: string | null
          id: string
          song_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          drive_file_id?: string | null
          drive_url?: string | null
          error?: string | null
          id?: string
          song_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          drive_file_id?: string | null
          drive_url?: string | null
          error?: string | null
          id?: string
          song_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      unlocked_songs: {
        Row: {
          cost_coins: number | null
          created_at: string
          id: string
          reference: string | null
          song_id: string
          source: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          cost_coins?: number | null
          created_at?: string
          id?: string
          reference?: string | null
          song_id: string
          source?: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          cost_coins?: number | null
          created_at?: string
          id?: string
          reference?: string | null
          song_id?: string
          source?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unlocked_songs_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          action: string
          created_at: string
          id: string
          label: string | null
          metadata: Json | null
          path: string | null
          user_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          id?: string
          label?: string | null
          metadata?: Json | null
          path?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          label?: string | null
          metadata?: Json | null
          path?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          browser: string | null
          device_type: string | null
          first_country: string | null
          first_seen_at: string
          id: string
          ip_subnet: string | null
          last_country: string | null
          last_seen_at: string
          os: string | null
          sign_in_count: number
          ua_hash: string
          user_id: string
        }
        Insert: {
          browser?: string | null
          device_type?: string | null
          first_country?: string | null
          first_seen_at?: string
          id?: string
          ip_subnet?: string | null
          last_country?: string | null
          last_seen_at?: string
          os?: string | null
          sign_in_count?: number
          ua_hash: string
          user_id: string
        }
        Update: {
          browser?: string | null
          device_type?: string | null
          first_country?: string | null
          first_seen_at?: string
          id?: string
          ip_subnet?: string | null
          last_country?: string | null
          last_seen_at?: string
          os?: string | null
          sign_in_count?: number
          ua_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      user_onboarding_checks: {
        Row: {
          checked_at: string
          detail: string | null
          key: string
          latency_ms: number | null
          ok: boolean
          user_id: string
        }
        Insert: {
          checked_at?: string
          detail?: string | null
          key: string
          latency_ms?: number | null
          ok: boolean
          user_id: string
        }
        Update: {
          checked_at?: string
          detail?: string | null
          key?: string
          latency_ms?: number | null
          ok?: boolean
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          density: string
          foul_intensity: number
          foul_mouth: boolean
          messenger_mode: string
          text_scale: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          density?: string
          foul_intensity?: number
          foul_mouth?: boolean
          messenger_mode?: string
          text_scale?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          density?: string
          foul_intensity?: number
          foul_mouth?: boolean
          messenger_mode?: string
          text_scale?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_webhook_settings: {
        Row: {
          enabled: boolean
          id: number
          last_error: string | null
          last_sent_at: string | null
          last_test_at: string | null
          last_test_ok: boolean | null
          secret: string | null
          target_url: string | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: number
          last_error?: string | null
          last_sent_at?: string | null
          last_test_at?: string | null
          last_test_ok?: boolean | null
          secret?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: number
          last_error?: string | null
          last_sent_at?: string | null
          last_test_at?: string | null
          last_test_ok?: boolean | null
          secret?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vip_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          og_vip_id: string | null
          plan: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          og_vip_id?: string | null
          plan?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          og_vip_id?: string | null
          plan?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vip_expiry_reminders: {
        Row: {
          expires_at: string
          kind: string
          sent_at: string
          user_id: string
        }
        Insert: {
          expires_at: string
          kind: string
          sent_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string
          kind?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vip_pass_credentials: {
        Row: {
          active: boolean
          assigned_at: string | null
          assigned_user_id: string | null
          coin_cost: number | null
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          password: string
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string | null
          assigned_user_id?: string | null
          coin_cost?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          password: string
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          assigned_at?: string | null
          assigned_user_id?: string | null
          coin_cost?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          password?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      vip_pass_purchases: {
        Row: {
          created_at: string
          credential_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_pass_purchases_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "vip_pass_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_promo_codes: {
        Row: {
          code: string
          created_at: string
          environment: string
          id: string
          redeemed_at: string | null
          stripe_promotion_code_id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          environment: string
          id?: string
          redeemed_at?: string | null
          stripe_promotion_code_id: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          environment?: string
          id?: string
          redeemed_at?: string | null
          stripe_promotion_code_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_battle_reward: {
        Args: { _earned_tenths: number; _user_id: string }
        Returns: Json
      }
      add_catchphrases: {
        Args: { p_kind: string; p_phrases: string[]; p_tone: string }
        Returns: number
      }
      admin_delete_lexicon_phrase: {
        Args: { p_phrase: string }
        Returns: boolean
      }
      admin_has_vault_pass: { Args: { p_user: string }; Returns: boolean }
      admin_list_lexicon: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          notes: string | null
          phrase: string
          severity: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "og_lexicon"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_referral_audit: {
        Args: { p_limit?: number; p_search?: string }
        Returns: Json
      }
      admin_referral_reconciliation: {
        Args: { p_limit?: number }
        Returns: Json
      }
      admin_update_profile_label: {
        Args: {
          admin_notes: string
          new_display_name: string
          target_user_id: string
        }
        Returns: string
      }
      admin_upsert_lexicon_phrase: {
        Args: {
          p_enabled?: boolean
          p_notes?: string
          p_phrase: string
          p_severity?: number
        }
        Returns: string
      }
      assign_og_vip_id: { Args: { p_user: string }; Returns: string }
      backpay_referral_cashback: { Args: { p_batch: string }; Returns: Json }
      boss_burn_coins: {
        Args: { amount: number; boss_notes?: string; target_user_id: string }
        Returns: number
      }
      boss_get_online_users: {
        Args: { p_minutes?: number }
        Returns: {
          coin_balance: number
          display_name: string
          email: string
          id: string
          last_activity_at: string
          last_label: string
          last_path: string
        }[]
      }
      boss_reclaim_coins: {
        Args: { amount: number; boss_notes?: string; target_user_id: string }
        Returns: number
      }
      cancel_song_generation: {
        Args: { p_song: string; p_user: string }
        Returns: Json
      }
      check_generation_capacity: { Args: { p_user: string }; Returns: Json }
      claim_daily_drop: { Args: never; Returns: Json }
      claim_due_orchestrations: {
        Args: { p_limit?: number }
        Returns: {
          audio_path: string | null
          beat_path: string | null
          completed_at: string | null
          cover_url: string | null
          created_at: string
          drive_archived_at: string | null
          drive_audio_id: string | null
          drive_audio_link: string | null
          drive_lyrics_id: string | null
          drive_lyrics_link: string | null
          duration_seconds: number | null
          error_message: string | null
          extra_context: string | null
          failure_class: string | null
          foul_intensity: number
          foul_mouth: boolean
          generation_started_at: string | null
          id: string
          is_public: boolean
          is_variation: boolean
          last_auto_retry_at: string | null
          lyric_video_error: string | null
          lyric_video_full_path: string | null
          lyric_video_preview_path: string | null
          lyric_video_progress: number
          lyric_video_rendered_at: string | null
          lyric_video_stage: string | null
          lyric_video_status: string
          lyric_video_unlocked: boolean
          lyrics: string | null
          lyrics_progress: number | null
          lyrics_stage: string | null
          lyrics_started_at: string | null
          next_retry_at: string | null
          orchestration: Json | null
          orchestration_attempts: number
          orchestration_due_at: string | null
          portal_id: string | null
          prompt: string
          retry_count: number
          retry_payload: Json | null
          revealed: boolean
          sample_path: string | null
          status: string
          stream_audio_url: string | null
          style: string | null
          suno_clip_id: string | null
          suno_task_id: string | null
          target_duration_sec: number | null
          title: string | null
          unlocked: boolean
          unlocked_at: string | null
          updated_at: string
          user_id: string
          vocals_only: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "songs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_song_retries: {
        Args: { p_limit?: number }
        Returns: {
          audio_path: string | null
          beat_path: string | null
          completed_at: string | null
          cover_url: string | null
          created_at: string
          drive_archived_at: string | null
          drive_audio_id: string | null
          drive_audio_link: string | null
          drive_lyrics_id: string | null
          drive_lyrics_link: string | null
          duration_seconds: number | null
          error_message: string | null
          extra_context: string | null
          failure_class: string | null
          foul_intensity: number
          foul_mouth: boolean
          generation_started_at: string | null
          id: string
          is_public: boolean
          is_variation: boolean
          last_auto_retry_at: string | null
          lyric_video_error: string | null
          lyric_video_full_path: string | null
          lyric_video_preview_path: string | null
          lyric_video_progress: number
          lyric_video_rendered_at: string | null
          lyric_video_stage: string | null
          lyric_video_status: string
          lyric_video_unlocked: boolean
          lyrics: string | null
          lyrics_progress: number | null
          lyrics_stage: string | null
          lyrics_started_at: string | null
          next_retry_at: string | null
          orchestration: Json | null
          orchestration_attempts: number
          orchestration_due_at: string | null
          portal_id: string | null
          prompt: string
          retry_count: number
          retry_payload: Json | null
          revealed: boolean
          sample_path: string | null
          status: string
          stream_audio_url: string | null
          style: string | null
          suno_clip_id: string | null
          suno_task_id: string | null
          target_duration_sec: number | null
          title: string | null
          unlocked: boolean
          unlocked_at: string | null
          updated_at: string
          user_id: string
          vocals_only: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "songs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_guest_battle: {
        Args: { _guest_id: string; _user_id: string }
        Returns: Json
      }
      claim_presence_alert: {
        Args: { p_cooldown_minutes: number; p_kind: string; p_user: string }
        Returns: boolean
      }
      claim_referral: { Args: { p_referrer: string }; Returns: boolean }
      claim_referrer_permanent: {
        Args: { p_acknowledged: boolean; p_referrer: string }
        Returns: Json
      }
      clawback_stripe_purchase: {
        Args: {
          _mode: string
          _purchase_reference: string
          _refund_id: string
          _user_id: string
        }
        Returns: Json
      }
      consume_chat_image_edit: {
        Args: { p_reference: string; p_user: string }
        Returns: Json
      }
      create_og_bot_invite: {
        Args: {
          p_claim_expires_at?: string
          p_notes?: string
          p_token_expires_at?: string
        }
        Returns: string
      }
      credit_coin_transaction: {
        Args: {
          _amount: number
          _reference: string
          _type: string
          _user_id: string
        }
        Returns: Json
      }
      credit_payment_referral: {
        Args: {
          _payment_reference: string
          _referee_id: string
          _reward_coins: number
        }
        Returns: Json
      }
      daily_coin_floor: { Args: never; Returns: number }
      deduct_coins: {
        Args: { p_amount: number; p_reference: string; p_user: string }
        Returns: number
      }
      dev_override_balance: {
        Args: {
          dev_notes?: string
          new_balance: number
          target_user_id: string
        }
        Returns: number
      }
      dev_send_og_message_as_bot: {
        Args: { message_content: string; target_user_id: string }
        Returns: string
      }
      gen_bot_token_string: { Args: never; Returns: string }
      gen_og_bot_invite_code: { Args: never; Returns: string }
      gen_og_bot_token: { Args: never; Returns: string }
      gen_og_referral_code: { Args: never; Returns: string }
      get_my_referrer: { Args: never; Returns: Json }
      get_referral_summary: { Args: never; Returns: Json }
      grant_vault_pass: { Args: { p_user: string }; Returns: boolean }
      grant_welcome_bonus: {
        Args: { _eligible: boolean; _user_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_sports_guide_access: { Args: { _user: string }; Returns: boolean }
      increment_bot_interactions: {
        Args: { p_delta?: number }
        Returns: number
      }
      increment_coin_balance: {
        Args: { _delta: number; _user_id: string }
        Returns: number
      }
      learn_battle_words: { Args: { p_words: string[] }; Returns: undefined }
      list_community_songs: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          audio_path: string
          completed_at: string
          cover_url: string
          created_at: string
          duration_seconds: number
          id: string
          is_variation: boolean
          revealed: boolean
          sample_path: string
          status: string
          stream_audio_url: string
          style: string
          title: string
          unlocked: boolean
          user_id: string
        }[]
      }
      list_og_bot_remote_tokens_safe: {
        Args: never
        Returns: {
          created_at: string
          created_by: string
          expires_at: string
          external_user: string
          grants_vip: boolean
          id: string
          origin_host: string
          revoked_at: string
          token: string
          uses_remaining: number
        }[]
      }
      log_user_activity: {
        Args: {
          p_action: string
          p_label: string
          p_metadata?: Json
          p_path: string
        }
        Returns: undefined
      }
      lookup_referrer: { Args: { p_referrer: string }; Returns: Json }
      lookup_referrer_by_code: { Args: { p_code: string }; Returns: Json }
      mint_coins: {
        Args: { p_amount: number; p_reason?: string; p_target: string }
        Returns: number
      }
      mint_coins_admin: {
        Args: { admin_notes: string; amount: number; target_user_id: string }
        Returns: number
      }
      my_generation_terms: { Args: never; Returns: Json }
      og_learn_insult: {
        Args: { p_phrase: string; p_user_id: string }
        Returns: undefined
      }
      og_vip_id_for: { Args: { p_name: string }; Returns: string }
      pay_referral_cashback: {
        Args: { p_burn: number; p_referee: string; p_reference: string }
        Returns: number
      }
      payout_battle_reward: { Args: { _user_id: string }; Returns: Json }
      pick_catchphrases: {
        Args: { p_tone: string; p_user: string }
        Returns: Json
      }
      pick_roasts: {
        Args: { p_n?: number; p_tone: string; p_user: string }
        Returns: Json
      }
      pick_trade_hold: {
        Args: { p_tone: string; p_user: string }
        Returns: Json
      }
      prepay_track: { Args: { p_song: string; p_user: string }; Returns: Json }
      purchase_bot_token: {
        Args: { p_allowed_domain?: string }
        Returns: {
          id: string
          token_string: string
        }[]
      }
      purchase_owner_track: {
        Args: { p_song: string; p_user: string }
        Returns: Json
      }
      purchase_sports_guide_access: { Args: never; Returns: Json }
      purchase_sports_guide_access_for_user: {
        Args: { p_user: string }
        Returns: Json
      }
      purchase_vip: { Args: never; Returns: number }
      purchase_vip_pass_for_user: { Args: { p_user: string }; Returns: Json }
      purge_expired_vip_roles: { Args: never; Returns: number }
      redeem_og_bot_invite: { Args: { p_code: string }; Returns: string }
      referral_owed_hundredths: {
        Args: never
        Returns: {
          net_burned: number
          owed_hundredths: number
          rate_pct: number
          referrer_id: string
        }[]
      }
      referral_rate_pct: { Args: { p_user: string }; Returns: number }
      refund_chat_image_edit: {
        Args: {
          p_free: boolean
          p_prev: string
          p_reference: string
          p_user: string
        }
        Returns: undefined
      }
      refund_generation_charge: {
        Args: { p_amount: number; p_reference: string; p_user: string }
        Returns: number
      }
      regenerate_og_bot_token: {
        Args: { target_user_id: string }
        Returns: string
      }
      restore_instant_refund_clawback: {
        Args: { _purchase_reference: string; _user_id: string }
        Returns: Json
      }
      reverse_referral_rewards_for_refund: {
        Args: { _env: string; _referee_id: string; _session_id: string }
        Returns: Json
      }
      revoke_og_bot_invite: { Args: { p_invite_id: string }; Returns: boolean }
      revoke_og_bot_token: {
        Args: { admin_notes?: string; target_user_id: string }
        Returns: string
      }
      set_balance_admin: {
        Args: {
          admin_notes: string
          new_balance: number
          target_user_id: string
        }
        Returns: number
      }
      set_boss_admin: {
        Args: {
          admin_notes?: string
          make_boss: boolean
          target_user_id: string
        }
        Returns: boolean
      }
      set_dev_admin: {
        Args: {
          admin_notes?: string
          make_dev: boolean
          target_user_id: string
        }
        Returns: boolean
      }
      set_og_bot_admin: {
        Args: { admin_notes?: string; make_og: boolean; target_user_id: string }
        Returns: boolean
      }
      set_og_bot_token_expiry: {
        Args: {
          admin_notes?: string
          new_expires_at: string
          target_user_id: string
        }
        Returns: string
      }
      set_site_content: {
        Args: { p_key: string; p_value: string }
        Returns: string
      }
      set_vault_pass_admin: {
        Args: {
          admin_notes?: string
          grant_access: boolean
          target_user_id: string
        }
        Returns: boolean
      }
      set_vip_admin: {
        Args: {
          admin_notes?: string
          make_vip: boolean
          target_user_id: string
        }
        Returns: boolean
      }
      set_vip_expiry_admin: {
        Args: {
          admin_notes?: string
          new_expires_at: string
          target_user_id: string
        }
        Returns: string
      }
      start_generation_charge: {
        Args: { p_reference: string; p_song: string; p_user: string }
        Returns: Json
      }
      start_vip_trial_once: { Args: never; Returns: Json }
      sync_owner_track_bonus: { Args: { p_song: string }; Returns: undefined }
      unlock_community_track: {
        Args: {
          _buyer: string
          _cost: number
          _royalty: number
          _song_id: string
        }
        Returns: Json
      }
      unpaid_track_count: {
        Args: { p_exclude?: string; p_user: string }
        Returns: number
      }
      unrevoke_og_bot_token: {
        Args: { admin_notes?: string; target_user_id: string }
        Returns: boolean
      }
      validate_bot_token: {
        Args: { p_origin: string; p_token: string }
        Returns: boolean
      }
      verify_song_retry_token: { Args: { p_token: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user" | "vip" | "og_bot" | "dev" | "boss"
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
      app_role: ["admin", "user", "vip", "og_bot", "dev", "boss"],
    },
  },
} as const
