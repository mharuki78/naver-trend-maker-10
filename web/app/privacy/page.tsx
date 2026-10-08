import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata = { title: "개인정보 안내 | 네이버 트렌드 마법사" };

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/sourcing/admin">← 네이버 트렌드 마법사</Link>
      <article className={styles.document}>
        <p className={styles.company}>배곧인터내셔널</p>
        <h1>개인정보 안내</h1>
        <p>네이버 트렌드 마법사는 계정별로 분석 조건과 작업 결과를 저장하는 업무 도구입니다.</p>
        <p className={styles.updated}>적용일: 2026년 10월 8일</p>
        <section>
          <h2>로그인에 사용하는 정보</h2>
          <p>Google 로그인 시 Google에서 확인된 이름, 이메일 주소, 계정 식별자를 받아 계정을 생성하거나 연결합니다. 로그인 권한은 기본 프로필과 이메일 확인에 한정합니다. Google 비밀번호를 받거나 저장하지 않으며 Gmail, Google Drive의 파일, 연락처 접근 권한을 요청하지 않습니다.</p>
          <p>이메일 가입을 선택하면 이름, 이메일 주소와 비밀번호 검증용 해시를 저장합니다. 원문 비밀번호는 저장하지 않습니다.</p>
        </section>
        <section>
          <h2>업무 정보와 이용 목적</h2>
          <p>사용자가 입력한 분석 조건, 수집 실행 기록과 결과를 계정에 연결해 저장합니다. 계정 식별과 로그인 유지, 본인의 작업 조회 및 이어서 분석하기에 사용하며, 로그인 정보를 광고 목적으로 사용하거나 판매하지 않습니다.</p>
        </section>
        <section>
          <h2>저장 위치와 로그인 유지</h2>
          <p>웹 화면은 Vercel에서 제공하고, 계정 및 업무 데이터는 배곧 전용 Cloudflare Worker와 D1 데이터베이스에서 처리합니다. Google은 Google 계정 인증을 처리합니다. 서비스 제공업체의 글로벌 인프라를 통해 정보가 처리될 수 있습니다.</p>
          <p>이 브라우저에서 로그인 상태를 유지하기 위해 로그인 토큰을 로컬 저장소에 보관합니다. 로그아웃하면 해당 토큰을 삭제하고 서버 세션을 해제합니다. 서버 로그인 세션의 유효 기간은 30일입니다.</p>
        </section>
        <section>
          <h2>보관과 삭제 요청</h2>
          <p>계정과 저장된 업무 기록은 서비스 이용을 위해 보관합니다. 자동 삭제 기간은 현재 설정되어 있지 않습니다. 작업 실행 결과는 화면의 삭제 기능을 이용할 수 있으며, 계정 정보 확인·수정·전체 삭제는 운영 담당자에게 요청할 수 있습니다.</p>
          <p>Google 계정의 연결된 앱 관리에서도 로그인 권한을 철회할 수 있습니다. Google 권한 철회와 이 서비스에 이미 저장된 계정·업무 정보 삭제는 별도 절차입니다.</p>
        </section>
        <section>
          <h2>운영 담당자</h2>
          <p>배곧인터내셔널 · <a href="mailto:golf4484@naver.com">golf4484@naver.com</a></p>
        </section>
      </article>
    </main>
  );
}
