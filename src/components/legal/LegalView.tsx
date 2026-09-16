import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface LegalSection {
  title: string;
  paragraphs: string[];
}

interface LegalDocumentProps {
  eyebrow: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}

const updatedAt = '2026-04-18';

function LegalDocument({ eyebrow, title, intro, sections }: LegalDocumentProps) {
  return (
    <main className="legal-page">
      <article className="legal-document">
        <Link to="/" className="legal-back-link">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回首页
        </Link>

        <header className="legal-header">
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <div>{intro}</div>
          <time dateTime={updatedAt}>更新日期 {updatedAt}</time>
        </header>

        <div className="legal-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <div>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}

const privacySections: LegalSection[] = [
  {
    title: '收集的信息',
    paragraphs: [
      '当你注册或使用 Google 登录时，本应用会接收并保存完成登录所需的基础账户信息，例如邮箱地址、公开昵称以及与账户关联的唯一身份标识。',
      '当你使用产品时，我们还会保存你主动提交的学习内容，例如导入的单词、学习进度、复习记录、学习偏好，以及为你生成的学习材料。',
    ],
  },
  {
    title: '信息用途',
    paragraphs: [
      '这些数据只用于提供核心产品能力，包括登录鉴权、跨设备同步学习进度、生成学习内容、安排复习、展示词库状态，以及保障服务稳定和安全。',
      '我们不会把你的学习数据出售给第三方，也不会把你的 Google 账户数据用于与你当前产品功能无关的广告用途。',
    ],
  },
  {
    title: '第三方服务',
    paragraphs: [
      '本应用使用 Google 作为可选登录提供方，并使用 Supabase 提供账户会话、数据库和存储能力。你通过这些能力提交的数据，可能会在这些基础设施中被处理，以完成认证、存储和同步。',
      '当你触发 AI 生成学习内容时，系统会把完成该功能所必需的最小输入发送给相关模型服务，用于返回你在产品界面中主动请求的结果。',
    ],
  },
  {
    title: '数据保留与控制',
    paragraphs: [
      '只要你的账户仍在使用，我们会保留支撑产品正常运行所必需的数据。若你停止使用或要求删除账户，相关学习数据会在合理范围内被删除或匿名化处理，但出于安全、审计或法律义务而必须保留的内容除外。',
      '如果你不想继续使用 Google 登录，可以改用邮箱密码登录，或在 Google 账户的已授权应用列表中撤销本应用的访问权限。',
    ],
  },
  {
    title: '安全与更新',
    paragraphs: [
      '我们会采取合理的技术和管理措施保护账户、会话和学习数据，但任何联网服务都无法承诺绝对零风险。',
      '当产品功能、数据流或合规要求发生变化时，这份隐私政策可能会更新；更新后的版本会发布在当前页面。',
    ],
  },
];

const termsSections: LegalSection[] = [
  {
    title: '服务说明',
    paragraphs: [
      'Lumina 是一个英语词汇学习服务。你可以通过邮箱密码或 Google 账户登录，并使用词汇导入、学习、复习与内容生成等功能。',
      '你需要对自己提交的内容、账户操作以及由此产生的后果负责。你应确保自己有权上传或输入相关学习材料。',
    ],
  },
  {
    title: '账户与访问',
    paragraphs: [
      '你应妥善保管自己的登录方式，不得借用、盗用或冒用他人账户，不得尝试绕过正常鉴权、访问控制或服务限制。',
      '如果系统检测到异常使用、滥用接口、自动化攻击、恶意抓取或其他危及服务稳定与安全的行为，我们可以暂停或限制相关访问。',
    ],
  },
  {
    title: '可接受使用',
    paragraphs: [
      '你不得利用本服务传播违法内容、侵犯他人权利、攻击基础设施，或把服务用于与正常学习目的明显无关的滥用场景。',
      'AI 生成内容仅作为学习辅助，不构成考试承诺、专业建议或结果保证。你应自行判断和核对其准确性与适用性。',
    ],
  },
  {
    title: '知识产权与数据',
    paragraphs: [
      '产品界面、系统设计和服务实现归服务提供方所有；你保留自己提交学习内容的相应权利，但授予本服务为完成存储、同步、展示与生成结果所必需的处理权限。',
      '你可以在遵守适用法律和这些条款的前提下正常使用产品，不得复制、转售、反向利用或以其他方式不当牟利。',
    ],
  },
  {
    title: '责任边界',
    paragraphs: [
      '我们会尽力保持服务可用，但不保证服务始终不中断、无错误或完全符合你的特定需求。对于因网络、第三方平台、账户封禁、不可抗力或你自己的操作导致的损失，我们承担的责任以适用法律允许的范围为限。',
      '继续使用本服务，即表示你同意遵守当前版本的服务条款以及与之配套的隐私政策。',
    ],
  },
];

export function PrivacyView() {
  return (
    <LegalDocument
      eyebrow="Privacy"
      title="隐私政策"
      intro="本政策说明 Lumina 在登录、学习和同步过程中处理的信息及其用途。"
      sections={privacySections}
    />
  );
}

export function TermsView() {
  return (
    <LegalDocument
      eyebrow="Terms"
      title="服务条款"
      intro="本条款说明使用 Lumina 的基本规则、服务范围与责任。"
      sections={termsSections}
    />
  );
}
