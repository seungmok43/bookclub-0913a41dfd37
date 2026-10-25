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
  // slug: a book folder name, or a new slug with title (a book with no folder yet). example: true shows an 「예시」 badge.
  // currentBooks: one entry per group (group = card label). If it is absent, currentBook (one book) is used as before.
  currentBooks: [
    {
      group: '수요 오전',
      slug: 'faith-again',
      title: '다시, 믿음을 묻다',
      subtitle: '오늘을 위한 에드워즈의 신학 수업',
      author: '전희준',
      publisher: '이레서원',
      cover: 'covers/faith-again.jpg',
      note: '',
      nextMeeting: '매주 수요일 오전 9시',
      place: '',
      example: false
    },
    {
      group: '금요 저녁',
      slug: 'what-we-believe',
      title: '우리가 믿는 것들에 대하여',
      subtitle: '사도신경에 담긴 그리스도교 신앙 해설',
      author: '김진혁',
      publisher: '복있는사람',
      cover: 'covers/what-we-believe.jpg',
      note: '',
      nextMeeting: '매주 금요일 저녁 7시',
      place: '',
      example: false
    }
  ]
};
