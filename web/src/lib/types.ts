export type TicketType = 'General' | 'Preferencial' | 'VIP' | 'Cortesía';

export type Mix = Record<TicketType, number>;

export interface EventRow {
  id: string;
  title: string;
  artistId: string;
  artist: string;
  city: string;
  venue: string;
  capacity: number;
  startsAt: string;
  weekday: string;
  month: 'julio' | 'agosto';
  isResidency: boolean;
  isUpcoming: boolean;
  residencyVenue: string | null;
  ticketsSold: number;
  mix: Mix;
  issued: number;
  attended: number | null;
  attendanceRate: number | null;
  fillRate: number;
  courtesyShare: number;
  revenue: number;
  mixExpected: number;
  lift: number | null;
}

export interface ArtistRow {
  id: string;
  name: string;
  city: string;
  hasResidency: boolean;
  residencyVenue: string | null;
  residencyWeekday: string | null;
  eventsPast: number;
  eventsUpcoming: number;
  issuedJuly: number;
  attendedJuly: number;
  rateJuly: number | null;
  courtesyShareJuly: number | null;
}

export interface RateRow {
  type: string;
  issued?: number;
  attended?: number;
  tickets?: number;
  used?: number;
  rate: number;
}

export interface LiftRow {
  key: string;
  attended: number;
  expected: number;
  events: number;
  raw: number;
  lift: number;
}

export interface GroupRow {
  key: string;
  events: number;
  issued: number;
  attended: number;
  capacity: number;
  courtesy: number;
  rate: number;
  fill: number;
  courtesyShare: number;
}

export interface Dataset {
  meta: { generatedAt: string; today: string; source: string; ticketTypes: TicketType[] };
  calibration: {
    byTicketType: RateRow[];
    boomByType: RateRow[];
    global: { issued: number; attended: number; rate: number };
    dilution: {
      slope: number;
      intercept: number;
      r2: number;
      n: number;
      points: { id: string; x: number; y: number; lift: number | null; issued: number; artist: string }[];
    };
    residualDilution: { slope: number; intercept: number; r2: number; n: number };
    liftByArtist: LiftRow[];
    liftByVenue: LiftRow[];
    liftByWeekday: LiftRow[];
    shrink: number;
    overdispersion: number;
  };
  events: EventRow[];
  artists: ArtistRow[];
  stats: {
    july: { events: number; issued: number; attended: number; capacity: number; revenue: number; courtesy: number };
    august: { events: number; issued: number; capacity: number; courtesy: number };
    byCity: GroupRow[];
    byVenue: GroupRow[];
    byWeekday: GroupRow[];
    byResidency: GroupRow[];
    byChannel: { key: string; issued: number; attended: number; rate: number }[];
    arrivalCurve: { minutes: number; count: number; share: number }[];
    boom: {
      users: number;
      withMembership: number;
      avgUseRate: number;
      avgUseRateMembers: number;
      avgFriends: number;
      useRateHistogram: { bin: string; lo: number; count: number }[];
    };
  };
}
