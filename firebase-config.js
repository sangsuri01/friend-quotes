// ===== 공유 저장소 설정 =====
// 계정 없이 모두가 같은 데이터를 보는 공유 저장소(textdb.dev)의 ID.
// 이 ID를 아는 사람(= 이 사이트를 가진 사람)은 누구나 읽고 쓸 수 있어요.
// 새 모음집을 따로 만들고 싶으면 아무 긴 문자열로 바꾸면 돼요.
window.SHARED_DB_ID = "friend-quotes-6cc97bfd-b9e4-43c3-a0df-30c6ff2d9778";

// (선택) Firebase를 쓰고 싶을 때만 채우세요. 채우면 Firebase가 우선 사용돼요.
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
