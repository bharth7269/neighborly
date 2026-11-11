export type CircleKind = 'society' | 'campus' | 'other'
export type MemberRole = 'member' | 'moderator' | 'admin'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'suspended'
export type ItemTier = 'free' | 'protected' | 'premium'
export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair'
export type ItemStatus = 'available' | 'reserved' | 'on_loan' | 'paused' | 'removed'
export type LoanStatus =
  | 'requested' | 'approved' | 'declined' | 'cancelled'
  | 'active' | 'returned' | 'completed' | 'disputed' | 'resolved'
export type Stage = 'pickup' | 'return'

export interface Profile { id: string; display_name: string; bio: string | null; trust_score: number; created_at: string }
export interface Circle { id: string; name: string; kind: CircleKind; city: string | null }
export interface Membership { circle_id: string; user_id: string; role: MemberRole; status: MemberStatus; circles: Circle }

export interface Item {
  id: string; circle_id: string; owner_id: string; title: string; description: string; category: string
  condition: ItemCondition; tier: ItemTier; min_trust: number; deposit_inr: number; max_days: number
  status: ItemStatus; photo_paths: string[]; created_at: string
  owner?: Pick<Profile, 'id' | 'display_name' | 'trust_score'>
}

export interface Loan {
  id: string; item_id: string; circle_id: string; lender_id: string | null; borrower_id: string | null
  status: LoanStatus; start_date: string; end_date: string; message: string; deposit_inr: number
  approved_at: string | null; started_at: string | null; due_at: string | null; returned_at: string | null
  closed_at: string | null; created_at: string
  item?: Pick<Item, 'id' | 'title' | 'photo_paths' | 'tier' | 'circle_id'>
  lender?: Pick<Profile, 'id' | 'display_name' | 'trust_score'> | null
  borrower?: Pick<Profile, 'id' | 'display_name' | 'trust_score'> | null
}

export interface HandoverPhoto { id: string; loan_id: string; stage: Stage; taken_by: string | null; storage_path: string; sha256: string; server_time: string }
export interface Message { id: string; loan_id: string; sender_id: string | null; body: string; created_at: string }
export interface Notification { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
export interface RequestPost { id: string; circle_id: string; requester_id: string; need: string; details: string; needed_by: string | null; status: 'open' | 'fulfilled' | 'closed'; created_at: string; requester?: Pick<Profile, 'id' | 'display_name'> }
export interface Dispute { loan_id: string; raised_by: string | null; reason: string; status: 'open' | 'resolved'; outcome: string | null; notes: string | null; deposit_to_lender_inr: number | null; created_at: string }

export const CATEGORIES = [
  ['tools', 'Tools'], ['kitchen', 'Kitchen'], ['electronics', 'Electronics'], ['outdoor', 'Outdoor & camping'],
  ['sports', 'Sports'], ['party', 'Party & events'], ['kids', 'Kids'], ['books', 'Books'], ['other', 'Other'],
] as const

export const CONDITION_LABEL: Record<ItemCondition, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair' }
export const TIER_LABEL: Record<ItemTier, string> = { free: 'Free to borrow', protected: 'Deposit', premium: 'Premium' }

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  requested: 'Waiting for owner', approved: 'Ready for pickup', declined: 'Declined', cancelled: 'Cancelled',
  active: 'On loan', returned: 'Owner is checking it', completed: 'Completed', disputed: 'Under review', resolved: 'Resolved',
}
