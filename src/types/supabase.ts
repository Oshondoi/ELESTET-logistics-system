export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string
          account_id: string
          store_code: string
          name: string
          marketplace: string
          api_key: string | null
          supplier: string | null
          address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          store_code?: string
          name: string
          marketplace?: string
          api_key?: string | null
          supplier?: string | null
          address?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['stores']['Insert']>
        Relationships: []
      }
      shipments: {
        Row: {
          id: string
          account_id: string
          store_id: string
          tracking_number: number
          tracking_code: string
          carrier: string
          destination_warehouse: string
          box_qty: number
          units_qty: number
          units_total: number
          arrived_box_qty: number
          planned_marketplace_delivery_date: string | null
          arrival_date: string | null
          status: string
          payment_status: string
          comment: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_id: string
          store_id: string
          tracking_number?: number
          tracking_code?: string
          carrier: string
          destination_warehouse: string
          box_qty?: number
          units_qty?: number
          units_total?: number
          arrived_box_qty?: number
          planned_marketplace_delivery_date?: string | null
          arrival_date?: string | null
          status: string
          payment_status: string
          comment?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['shipments']['Insert']>
        Relationships: []
      }
      shipment_status_history: {
        Row: {
          id: string
          shipment_id: string
          old_status: string | null
          new_status: string
          changed_at: string
          changed_by: string | null
        }
        Insert: {
          id?: string
          shipment_id: string
          old_status?: string | null
          new_status: string
          changed_at?: string
          changed_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['shipment_status_history']['Insert']>
        Relationships: []
      }
      accounts: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['accounts']['Insert']>
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          user_id: string
          full_name: string
          short_id: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          full_name: string
          short_id?: number | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      account_members: {
        Row: {
          id: string
          account_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['account_members']['Insert']>
        Relationships: []
      }
      trips: {
        Row: {
          id: string
          account_id: string
          draft_number: number
          trip_number: string | null
          carrier: string
          departure_date: string | null
          status: string
          payment_status: string
          comment: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_id: string
          draft_number?: number
          trip_number?: string | null
          carrier: string
          departure_date?: string | null
          status?: string
          payment_status?: string
          comment?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['trips']['Insert']>
        Relationships: []
      }
      trip_lines: {
        Row: {
          id: string
          trip_id: string
          account_id: string
          store_id: string
          shipment_number: number
          destination_warehouse: string
          box_qty: number
          units_qty: number
          units_total: number
          arrived_box_qty: number
          planned_marketplace_delivery_date: string | null
          arrival_date: string | null
          status: string
          payment_status: string
          comment: string
          invoice_photo_urls: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          trip_id: string
          account_id: string
          store_id: string
          shipment_number?: number
          destination_warehouse: string
          box_qty?: number
          units_qty?: number
          units_total?: number
          arrived_box_qty?: number
          planned_marketplace_delivery_date?: string | null
          arrival_date?: string | null
          status?: string
          payment_status?: string
          comment?: string
          invoice_photo_urls?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['trip_lines']['Insert']>
        Relationships: []
      }
      carriers: {
        Row: {
          id: string
          account_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          name: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['carriers']['Insert']>
        Relationships: []
      }
      warehouses: {
        Row: {
          id: string
          account_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          name: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['warehouses']['Insert']>
        Relationships: []
      }
      sticker_templates: {
        Row: {
          id: string
          account_id: string
          barcode: string
          name: string
          composition: string | null
          article: string | null
          brand: string | null
          size: string | null
          color: string | null
          supplier: string | null
          supplier_address: string | null
          production_date: string | null
          country: string
          copies: number
          icon_wash: boolean
          icon_iron: boolean
          icon_no_bleach: boolean
          icon_no_tumble_dry: boolean
          icon_eac: boolean
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          barcode: string
          name: string
          composition?: string | null
          article?: string | null
          brand?: string | null
          size?: string | null
          color?: string | null
          supplier?: string | null
          supplier_address?: string | null
          production_date?: string | null
          country?: string
          copies?: number
          icon_wash?: boolean
          icon_iron?: boolean
          icon_no_bleach?: boolean
          icon_no_tumble_dry?: boolean
          icon_eac?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sticker_templates']['Insert']>
        Relationships: []
      }
      sticker_bundles: {
        Row: {
          id: string
          account_id: string
          name: string
          items: Json
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          name: string
          items?: Json
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sticker_bundles']['Insert']>
        Relationships: []
      }
      roles: {
        Row: {
          id: string
          account_id: string
          name: string
          permissions: Json
          assigned_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          name: string
          permissions?: Json
          assigned_user_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['roles']['Insert']>
        Relationships: []
      }
      products: {
        Row: {
          id: string
          account_id: string
          store_id: string
          nm_id: number
          vendor_code: string | null
          name: string | null
          brand: string | null
          category: string | null
          color: string | null
          composition: string | null
          country: string | null
          barcodes: Json | null
          photos: Json | null
          sizes: Json | null
          raw_data: Json | null
          synced_at: string
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          store_id: string
          nm_id: number
          vendor_code?: string | null
          name?: string | null
          brand?: string | null
          category?: string | null
          color?: string | null
          composition?: string | null
          country?: string | null
          barcodes?: Json | null
          photos?: Json | null
          sizes?: Json | null
          raw_data?: Json | null
          synced_at?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['products']['Insert']>
        Relationships: []
      }
      store_sync_log: {
        Row: {
          id: string
          store_id: string
          account_id: string
          synced_at: string
          product_count: number | null
          status: string | null
          error: string | null
        }
        Insert: {
          id?: string
          store_id: string
          account_id: string
          synced_at?: string
          product_count?: number | null
          status?: string | null
          error?: string | null
        }
        Update: Partial<Database['public']['Tables']['store_sync_log']['Insert']>
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_shipment: {
        Args: {
          p_account_id: string
          p_store_id: string
          p_carrier: string
          p_destination_warehouse: string
          p_box_qty: number
          p_units_qty: number
          p_units_total: number
          p_arrived_box_qty: number
          p_planned_marketplace_delivery_date: string | null
          p_arrival_date: string | null
          p_status: string
          p_payment_status: string
          p_comment?: string
        }
        Returns: Database['public']['Tables']['shipments']['Row']
      }
      create_account_with_owner: {
        Args: {
          p_account_name: string
        }
        Returns: Database['public']['Tables']['accounts']['Row']
      }
      delete_account_with_owner: {
        Args: {
          p_account_id: string
        }
        Returns: boolean
      }
      create_trip: {
        Args: {
          p_account_id: string
          p_carrier: string
          p_departure_date?: string | null
          p_status?: string
          p_payment_status?: string
          p_comment?: string
        }
        Returns: Database['public']['Tables']['trips']['Row']
      }
      add_trip_line: {
        Args: {
          p_trip_id: string
          p_account_id: string
          p_store_id: string
          p_destination_warehouse: string
          p_box_qty?: number
          p_units_qty?: number
          p_units_total?: number
          p_arrived_box_qty?: number
          p_planned_marketplace_delivery_date?: string | null
          p_arrival_date?: string | null
          p_status?: string
          p_payment_status?: string
          p_comment?: string
        }
        Returns: Database['public']['Tables']['trip_lines']['Row']
      }
      update_trip_status: {
        Args: {
          p_account_id: string
          p_trip_id: string
          p_status: string
        }
        Returns: Database['public']['Tables']['trips']['Row']
      }
      resolve_account_user: {
        Args: {
          p_account_id: string
          p_email?: string | null
          p_user_id?: string | null
          p_short_id?: number | null
        }
        Returns: Array<{
          user_id: string
          email: string
          full_name: string
          short_id: number | null
        }>
      }
      get_my_accounts: {
        Args: Record<string, never>
        Returns: Array<{
          id: string
          name: string
          created_at: string
          my_role: string
        }>
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
