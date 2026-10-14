// BooKLove community settings.
//
// ⚠ PUBLIC FILE. Everything here can be read by anyone who opens the site.
//   Only public values may go here: the site name, the current-book card,
//   the Supabase project URL and its "anon public" key.
//   NEVER put the member code (입장 코드), a service_role key or a password here.
//
// supabaseUrl / supabaseAnonKey empty  →  체험 모드 (writes stay in this browser only).
// Fill both (see docs/운영안내.md)      →  실제 모드 (shared, code checked on the server).
window.BOOKLOVE_CONFIG = {
  siteName: 'BooKLove',
  tagline: '책으로 삶을 읽다',

  supabaseUrl: 'https://jbognvabwtikanwqiajo.supabase.co',
  supabaseAnonKey: 'sb_publishable_qYq0ARsXYfCv4KHB0DLXJQ_dSOo7u8-',

  // 지금 읽는 책 / 다음 모임 — edit these lines when the club moves on.
  // slug must match a book folder name (e.g. 'waste'). example: true shows an 「예시」 badge.
  currentBook: {
    slug: 'waste',
    note: '수요 오전 모임',
    nextMeeting: '날짜 미정 (예시)',
    place: '장소 미정 (예시)',
    example: true
  }
};
