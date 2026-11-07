// The BD team's playbook as first loaded: the "BD & Sales Playbook: The Rules of the Road" (v1.0, July 2026) and the
// Streamlined Response Workflow diagram, as sections of markdown. Loaded once, when the BD team has no sections yet;
// after that the page's editors own the text and nothing here is read again.

export const BD_META = {
  tagline: 'The Rules of the Road',
  version: '1.0 (July 2026)',
  workflow_image: '/playbook/knexus-streamlined-workflow.png',
};

export const BD_RHYTHM = {
  title: 'Team battle rhythm',
  body: `> Draft: for discussion with the SVP of BD.

To maintain pipeline velocity and resolve operational bottlenecks quickly, the BD team keeps a structured weekly battle rhythm.

### Weekly
- **Monday morning standup (15 min).** Status review of Pipedrive "Next Steps" across all active deals, and identification and resolution of operational blockages for H1/H2 sales targets.
- **Mid-week tech sync (30 min).** Strategic collaboration with Justin and the Sales Engineers to map technical bids, solution architectures and prototype scoping.
- **GovWin and SAM.gov review.** Every BD Director reviews their assigned account areas for RFIs, RFPs and Sources Sought notices and presents high-priority targets (see *Tool stack and hygiene*).

### Every two weeks
- **Google sync.** Joint pipeline review with Lindsay Wall (Partner Engagement Manager) and the Google FSRs to drive co-selling execution on active G4G and cloud opportunities.

### Monthly
- **Gate reviews.** Formal Go/No-Go evaluation of active capture strategies, RFI responses and RFP proposal submissions.

### Between meetings
- Every active opportunity has a scheduled activity (call, email, meeting, proposal draft) and a specific, dated Next Step in Pipedrive.
- Expected close dates reflect reality: a past-due close date means incomplete pipeline management.`,
};

export const BD_SECTIONS = [
  {
    title: 'Strategic vision and core frameworks',
    body: `### Company vision and market opportunity
Knexus is scaling to become the leading AI Solutions Platform serving the Public Sector. We are executing a structured growth path targeting **$130M in annual revenue by 2031**.

- **Market context.** US government spending on AI is expected to increase significantly, rising from around $10 billion in FY26 at a CAGR of 28% to exceed $26 billion by FY30.
- **Serviceable Addressable Market (SAM).** $13.8B projected SAM by 2030. Our $130M target represents 0.94% market penetration, reflecting a realistic, highly achievable expansion model.
- **Federal AI adoption bottleneck.** Despite macro initiatives (e.g., GenAI.mil), agency bottlenecks lie in connecting advanced AI models with siloed legacy data. Knexus solutions directly solve this gap.

### Knexus core capability areas
Knexus sells tailored, high-impact AI solutions across four capability areas:

- **AI Research & Innovation (Emerging AI & Prototyping)**
  - Focus: advanced math, privacy-enhancing technologies (PETs), autonomous scheduling, and LLM reasoning.
  - Problems solved: de-risks bleeding-edge tech via rapid prototyping before enterprise deployment.
  - Example past performance: DARPA TRACTOR, DARPA A3ML, NIST PETS, ONR CILEMP-FLAG.
- **AI Infrastructure (Enterprise AI Scaffolding)**
  - Focus: secure data fabric scaffolding, enterprise master management agents, and cross-domain data interoperability.
  - Problems solved: connects legacy databases into interactive, real-time mission assets without ripping and replacing underlying systems.
  - Past performance: DLA EMMA (Enterprise Master Management Agents) Control Towers & Foundational Data Fabric.
- **AI Applications (Use-Case Focused Solutions)**
  - Focus: tailored Generative AI applications for specialized operational workflows where commercial COTS falls short.
  - Problems solved: automates complex mission analysis, logistics, and decision support at scale.
  - Past performance: GAILFORCE (DLA Logistics GenAI), Project Foresight (Army Spares Management), NAVAIR NGTS-GPT.
- **AI Mission Operations (Operationalizing Agentic AI)**
  - Focus: multi-agent AI workforces deployed into core workflows, blending domain expertise with intelligent automation.
  - Problems solved: eliminates steep learning curves for complex platforms, optimizing financial management, intelligence analysis, and mission planning.
  - Past performance: currently the legacy S4 contracts Joint Staff J32 (ISRO), NORAD/USNORTHCOM (CWOC), USSTRATCOM (SCITLS), which do not include AI.

### Framework for sustainable AI solutions
Every opportunity, proposal, and architecture must sit at the intersection of three key drivers:

1. **What government leaders want.** Strategic AI priorities, high-level objectives, and procurement mandates documented in RFIs/RFPs.
2. **What end users need.** Operational realities and actual end-user pain points, uncovered early through direct discovery rather than relying solely on written specifications.
3. **What is technically viable.** Sound, scalable architectures that function securely and sustainably within the customer's specific IT environment.

Sustainable, high-impact solutions occur strictly at the three-way intersection where leader vision, user needs, and technical viability meet.`,
  },
  {
    title: 'Accountability, alignment and deal governance',
    body: `### End-to-end deal accountability
Knexus does not isolate sales, capture, proposal, and pricing functions into separate silos. BD Directors maintain single-point lifecycle accountability across four clear stages:

1. **Qualify.** Source leads, leverage advisory assets, and validate alignment with Knexus capabilities.
2. **Capture.** Engage government program managers, requirements owners, and end users to shape acquisition strategies around Knexus capabilities.
3. **Proposal and win strategy.** Architect win themes, drive AI-assisted drafting, coordinate technical architecture, and navigate gate reviews.
4. **Handoff.** Ensure seamless transition from award to our technical delivery teams.

> While you own the process, you have access to a dedicated support ecosystem designed to amplify your productivity (see *Support ecosystem*).

### CTO vs. CSO functional alignment
Technical and capture responsibilities are clearly bounded to enforce continuous validation.

**Chief Technology Officer (solution architecture and pre-sales technical validation)**
- Solution architecture and pre-sales engineering reside fully under the CTO.
- Pre-sales technical validation occurs continuously during capture, ensuring feasibility long before proposal writing begins.
- The CTO builds technical architecture diagrams and technical scope, and demos capabilities.

**Chief Solutions Officer (evangelist, "voice of the customer")**
- The CSO serves as the dedicated customer advocate and market strategist.
- Translates operational mission pain points into strategic pursuit vectors.
- Does not own technical architecture or engineering feasibility, but collaborates and coordinates with the CTO.

### Deal governance and mandatory risk controls
Before any proposal or binding agreement is submitted to a customer or partner, two non-negotiable risk controls are required:

- **CTO technical approval.** Validates technical feasibility, architecture alignment, resource availability, Work Breakdown Structures (WBS), and delivery commitments.
- **CEO pricing approval.** Validates labor rates, margins, business terms, contract terms, and overall risk posture.`,
  },
  {
    title: 'Support ecosystem',
    body: `### Internal support
To support the end-to-end model, Knexus provides you with a robust support framework. This team offloads mechanical and technical burdens so you can focus on customer engagement, strategic alignment, and closing deals.

| Support role | Who | Responsibilities to the BD Director |
|---|---|---|
| CEO | Adam Lurie | Approves pricing; signatory for all agreements (NDA, TA, contracts, etc.) |
| Chief Strategy Officer | Jim Thompson | Strategic growth guidance, corporate positioning, alignment with macro market trends |
| SVP of BD | TBD | Direct strategic coaching, gate reviews, and executive support |
| Proposal Manager | Dawnn McCullough | Owns compliance matrices, formatting, scheduling, and assembly of final submissions |
| BD Operations Manager | TBD | Manages CRM mechanics, pipeline hygiene, data reporting, and analytics |
| Partner Engagement Manager | Lindsay Wall | Co-sell alignment, and Google Public Sector and Carahsoft relationship management; deal tracking in Google's internal CRM to ensure Knexus gets appropriate credit |
| Marketing Manager | TBD | |
| Chief Solutions Officer | TBD | Acts as a customer advocate, translating operational pain points into high-level technical solution approaches |
| Sales Engineers / Solution Architects (3) | TBD | Technical pre-sales support: architecture diagrams and technical scopes; demos of existing and emerging Knexus capabilities |
| Technical and Delivery Teams | | WBS estimates, review of proposal drafts for technical accuracy, and execution of the project post-award |

### Advisory network
BD Directors must actively leverage Knexus retained advisors to gain access to senior command structures and validate requirements:

- **The Spectrum Group.** Federal consulting partner providing direct access to retired General Officers, Flag Officers, and Senior Executive Service (SES) leaders to navigate command hierarchies.
- **Jeff Curtis (Senior DLA Advisor).** Former DLA senior executive providing operational insights, key stakeholder mapping, and procurement navigation for DLA pursuits.
- **Pat Sullivan (Army Logistics Advisor).** Former Army logistics officer driving domain strategy and command-level entry across Army Materiel Command (AMC) and joint logistics elements.

### Knexus marketing and event attendance
TBD.`,
  },
  {
    title: 'Key performance metrics',
    body: `> Draft: for discussion with the SVP of BD.

### Sales and BD scorecard

| # | Metric category | Measurable | Owner |
|---|---|---|---|
| 1 | Total active pipeline | Weighted active pipeline ($ TCV) | CGO |
| 2 | Pipeline growth | New qualified deals added (# / $ TCV) | CGO |
| 3 | Customer / partner engagement | Customer and partner touchpoints | BD Directors |
| 4 | Pipeline stage conversion | # of deals progressed by stage / week | CGO |
| 5 | Proposal volume | Proposals / RFIs submitted (# / $ TCV) | BD Directors |
| 6 | Closed revenue | Bookings ($ TCV won) | CGO |
| 7 | Recognized revenue | $ recognized | CEO |
| 8 | Win efficiency | Win rate (% by count) | CGO |`,
  },
  {
    title: 'Tool stack and hygiene: GovWin, Pipedrive and Zarkon',
    body: `### Opportunity identification (GovWin)
Every BD Director is provided access to GovWin, our primary market intelligence platform. GovWin must be used systematically to track long-range procurements, monitor federal spending trends, and scan for open solicitations published on SAM.gov.

- **Nascent AI procurement landscape.** Because enterprise AI is still a developing capability area within the federal government, you will rarely see mature, "pure-play" AI development opportunities published directly on GovWin.
- **Recent RFI focus.** In 2026 we are seeing a higher volume of RFIs and Sources Sought notices. These are critical opportunities to shape requirements in our favor before a formal RFP is finalized.
- **Weekly cadence expectation.** BD Directors are expected to review SAM.gov and GovWin weekly. You must actively monitor your assigned account areas, identify relevant RFIs/RFPs, and present high-priority targets.

### Pipeline management and CRM hygiene (Pipedrive)
Our CRM, Pipedrive, is the primary operational source of truth for the Knexus growth engine. **If an opportunity is not in Pipedrive, it is not tracked.** We maintain strict pipeline hygiene to give our executive leadership (CEO Adam Lurie and CSO Jim Thompson) a clear, real-time view of pipeline health, forecast accuracy, and resource demands.

#### Strict CRM hygiene guidelines
- **No outdated close dates.** Expected close dates must reflect reality. A past-due close date indicates incomplete pipeline management.
- **Weekly task tracking.** Every active opportunity must have a scheduled activity (call, email, meeting, proposal draft).
- **Mandatory next step.** The "Next Step" field must contain an actionable, manually updated task. Generic phrases like "follow up" are prohibited. Instead, use: "Draft customized capability deck for Army Materiel Command SCRM lead and schedule meeting by July 15."

#### Mandatory Pipedrive deal template fields
You must fully populate the following ten fields for every opportunity in Pipedrive:

1. **Deal title.** Standardized format: [Agency] - [Project/System Name] - [Short Description, if appropriate] (e.g., DLA - EMMA - Data Fabric and Control Tower).
2. **Opportunity owner.** The assigned BD Director accountable for the deal.
3. **Deal value.** The total projected dollar value of the contract over all option years (TCV). Mandatory for any deal in the Capture stage or beyond.
4. **Account area.** Mapped directly to one of the 7 core Knexus account areas: Army; Navy / USMC; USAF / USSF; DoD 4th Estate; DHS / DOJ; Intel; FedCiv (Other).
5. **Capability area.** Aligned with our four main capabilities: Research & Innovation; AI Applications; AI Infrastructure; AI Mission Operations.
6. **Opportunity type.** Net New (new customer or brand new program) or Add-on / Renewal (extending current services).
7. **Google deal (yes/no).** Whether this opportunity is being co-sold, facilitated, or influenced by Google Public Sector. This matters for deal tracking in Google's system so that Knexus receives appropriate credit.
8. **Google FSR (Field Sales Representative) and counterpart.** Name and contact information of the Google sales rep aligned to the target account.
9. **Knexus IP utilization (yes/no).** Whether the solution incorporates proprietary Knexus intellectual property, software codebases, or frameworks (such as SWISH, KLOAK, or Zarkon).
10. **Submission due date** and **specific next step.** A clear, manually updated, actionable task with a deadline showing how the BD Director will progress the deal.

### Proposal content generation tool (Zarkon)
Zarkon is an internal tool used to streamline proposal writing (RFPs, RFIs). Zarkon grounds AI-generated output strictly within user-provided source documents, minimizing hallucinations and ensuring the generated text adheres precisely to specific past performance and technical references. See the *Zarkon user guide* for a step-by-step walkthrough.`,
  },
  {
    title: 'Account planning and sales motions',
    body: `### Strategic expectations for account plans
At Knexus, we hire experienced BD Directors and expect to see clear, strategic thinking across the sub-agencies and commands that populate your assigned account.

**Within your first 30 days, you are expected to submit an initial Account Plan.** This plan should cover, but isn't limited to, the following core elements:

- **Sub-agency and command mapping and prioritization.** A complete breakdown of the organizational hierarchy of your account (e.g., for the Army account, this means mapping out PEOs, AMC, Army Test and Evaluation Command, etc.). Within this mapping, who are the "Top 5" priority customer organizations that you will initially focus on, and why?
- **Key stakeholders.** Identification of key decision-makers, requirements owners, and program managers, along with an engagement strategy for each.
- **Prioritized multi-year target pipeline.** A clear, prioritized pipeline of new opportunities and expansions, categorized by capability area.
- **Co-sell and partner leverage plan.** Detailed mapping of Google Public Sector counterparts and co-selling opportunities.
- **Advisory network integration.** A plan for utilizing our external consulting assets to expand access and accelerate capture.

### The DLA blueprint: scaling from prototype to production
To understand how Knexus scales within a federal agency, study our DLA expansion framework. Over a 21-month journey, Knexus transitioned from a company-funded proof-of-concept into a multi-year Program of Record, establishing $100M in sole-source contract ceiling and booking over $10M in revenue.

#### The DLA progression timeline
- **Phase 1: Proof of concept (June 2024).** Knexus developed a SITREP rapid prototype entirely at company expense, demonstrated to DLA stakeholders as part of the DLA GenAI Hackathon contract competition. Technical feasibility was established, and trust was built with DLA requirements owners.
- **Phase 2: Paid pilot and prototype (October 2024).** DLA awarded Knexus the 5-year, $50M ceiling CPFF GenAI Hackathon IDIQ contract and Task Order #1 to build the SITREP prototype, officially named GAILFORCE. TCV and PoP: $935k, 12-month Period of Performance.
- **Phase 3: Adjacent prototyping and hardening (October 2025).** GAILFORCE pushed successfully to production in DLA's GCP environment; DLA awarded a 6-month Task Order extension for production transition ($625k, 6-month PoP). Using the expansion mechanism of our IDIQ, DLA awarded Task Orders #2, 3, 4 and 5 for four additional AI use-case prototypes: Annual Financial Report (AFR) Tool, Journal Voucher (JV) Workflow Assistant, Forecast Intelligence Technology (FIT), and Vendor Vetting/SCRM. TCV: $3.275M across the four new Task Orders (12-month PoP).
- **Phase 4: Enterprise infrastructure and production Program of Record.**
  - EMMA launch (December 2025): DLA awarded Task Orders #6 and 7 to build the Foundational Data Fabric Infrastructure and Control Towers for EMMA (Enterprise Master Management Agents). Total value: $3.8M, 12-month PoP.
  - The production Program of Record (April 2026): DLA awarded Knexus a 5-year, $50M ceiling FFP SBIR Phase III IDIQ contract for ongoing, long-term production work. Task Order #1 for GAILFORCE production was booked at $1.44M TCV (12-month PoP).

### Google co-sell sales motions
Our partnership with Google Public Sector is built on a shared mission: scale Google Cloud AI adoption in Government via Knexus managed service contracts focused on specific customer use cases. BD Directors must leverage two primary co-selling motions depending on who holds the account relationship and lead position.

#### 1. Knexus-led motions (Google in a supporting role)
Knexus drives customer engagement and solution definition while pulling in Google Public Sector resources to validate cloud infrastructure and provide sales leverage:

- **Expand agency use cases.** Identify and capture new AI applications within existing client accounts (e.g., expanding into SCRM, Vendor Vetting, and Financial Management at DLA).
- **Transition prototypes to production.** Drive successful prototypes into long-term production programs of record and enterprise deployments.
- **Commercialize Knexus SBIR technologies.** Scale and commercialize proprietary, SBIR-developed technology assets (e.g., CILEMP, NGTS-GPT) across civilian and defense agencies.
- **Inject AI into legacy IT contracts.** Modernize legacy S4 Enterprise IT and Mission Support vehicles (e.g., Joint ISR Operations) by introducing Google Cloud AI capabilities.
- **Net-new pipeline capture.** Generate and win net-new opportunities by driving task order flow through key GWAC, MATOC, and IDIQ contract vehicles.

#### 2. Google-led motions (Knexus in a supporting role)
Google Public Sector leads the overall account strategy, and Knexus serves as the specialized AI application layer that demonstrates GCP consumption value:

- **Deploy enterprise control towers.** Support Google-led enterprise initiatives by delivering common data fabrics and management architectures (e.g., DLA EMMA).
- **Rapid prototyping and RIT handoffs.** Conduct account-focused solution development using Google's Rapid Innovation Team (RIT) for initial proof-of-concept work, followed by a warm handoff to Knexus for prototype refinement, hardening, and operational deployment.
- **Gemini for Government (G4G) execution.** Qualify leads, conduct joint capability demonstrations, and support sales efforts for Gemini for Government opportunities.
- **Joint value presentations.** Participate in joint customer briefings to showcase how Knexus managed services unlock the full value of GCP cloud consumption.

By maintaining close coordination with your aligned Google FSRs, you can dynamically apply these motions to accelerate deal cycles and secure high-value sole-source awards.`,
  },
  {
    title: 'Streamlined response workflow',
    body: `The Knexus Streamlined Response Workflow is the short form of the Proposal Management Framework: use it for **RFIs, Sources Sought and white papers**. RFP and RFQ responses follow the full Proposal Management Workflow. The diagram is under the **Workflow** button at the top of this page; step numbers refer to the Streamlined Process tab of the Proposal Management Framework.

### Qualify and gate
- **S-1.1 Identify and assess opportunity** (BD Director), starting from the new request.
- **S-1.2 Validate feasibility and capabilities** (BD Director), with the Solution Architect / technical team confirming feasibility, capabilities and gaps.
- **S-1.3 Complete the Gate Checklist and present** (BD Director).
- **S-1.4 Gate decision** (SVP of Growth and leadership): *Proceed*, *No-Bid* (end), or *revise and resolve gaps* and come back to S-1.2.

### Plan response (Proposal Manager)
- **S-1.5 Set up the workspace, schedule and assignments.**
- **S-1.6 Analyze the instructions and build the outline.**
- **S-1.7 Confirm the response strategy and assignments**, with the BD Director's key messages and differentiators.

### Develop
- **S-1.8 Draft the response and supporting materials** (Proposal Coordinator and contributors), with technical input and validation from the Solution Architect / technical team.
- **S-1.9 ROM / pricing and Green Team, if requested** (Pricing / Finance).

### Review and approve
- **S-1.10 Red Team review** (Proposal Manager).
- **S-1.11 Incorporate review feedback** (Proposal Manager), with the BD Director's revisions and the pricing input.
- **S-1.12 Gold Team approval** (SVP of Growth and leadership); once approved, on to the final check.

### Submit and close
- **S-1.13 Final compliance check** (Proposal Manager).
- **S-1.14 Submit and archive the response** (Proposal Manager); the BD Director continues customer engagement.
- **S-1.15 Capture reusable content and quick lessons** (Proposal Manager), then end.

Customer insights and reusable content from each response inform the follow-on RFP and the next response.`,
  },
  {
    title: 'Appendix: BD Directors and corporate info',
    body: `### Knexus BD Directors

| Account area | COCOM alignment | Lead | Email / mobile |
|---|---|---|---|
| Army | AFRICOM, CENTCOM, EUCOM, SOCOM | Phil Tanenbaum | phil.tanenbaum@knexus.ai · 609-707-9134 |
| Navy / USMC | PACOM, SOUTHCOM | Tyler Watkins | tyler.watkins@knexus.ai · 704-533-1910 |
| Air Force / USSF | NORTHCOM, SPACECOM, STRATCOM | Vacant | |
| DoD 4th Estate | N/A | Roman Dzialo | roman.dzialo@knexus.ai · 269-317-1454 |
| Intelligence Community | CYBERCOM | Luke Baldwin | luke.baldwin@knexus.ai · 703-609-7650 |
| DHS / FBI | N/A | Cassandra Isbell | cassandra.isbell@knexus.ai · 757-407-2815 |
| FedCiv | N/A | Vacant | |

### Knexus corporate info

| Item | Value |
|---|---|
| Company name | Knexus Research LLC |
| Unique Entity Identifier (UEI) | W4U3DSMLMUK3 |
| CAGE | 4WYG2 |
| Facility clearance | Top Secret |
| NAICS (primary) | 541715: Research and Development in the Physical, Engineering, and Life Sciences (except Nanotechnology and Biotechnology) |
| NAICS (secondary) | 541512: Computer Systems Design Services · 541511: Custom Computer Programming Services · 541330: Engineering Services · 511512: Software Publishers |`,
  },
  {
    title: 'Zarkon user guide',
    body: `### Getting started
- **Access.** Navigate to the Zarkon link and self-register using your Knexus email address.
- **Projects.** Access existing team projects from the home dashboard, or select "Add New Project" to start fresh.

### Step-by-step workflow
1. **Gather and prepare references.** Create a dedicated project folder in Google Drive. Collect core proposal documents: Statement of Work (SOW), RFQ/RFP requirements, evaluation criteria, and past performance files. If no direct past performance exists, use Open Gemini to brainstorm an initial technical pitch, edit it, and include that "brainstorming whiteboard" document as a reference. You can also include transcribed call notes or technical white papers.
2. **Upload reference materials.** Click the hamburger menu in Zarkon to upload reference documents. Ensure all relevant background docs (SOW, past performance tables, white papers, notes) are attached so Zarkon can ground its answers in them.
3. **Establish global context.** Enter overall win strategies, core differentiators, and key technical approaches into the Global Context field. Zarkon references this overarching strategy across every section it generates.
4. **Build the outline.** Map sections directly to the solicitation's evaluation criteria or quote format. For each section, input the specific evaluation requirements into the outline, along with guidance on key points or differentiators to emphasize.
5. **Draft section by section.** Generate text one section at a time rather than the entire proposal at once. Leave the Executive Summary and Conclusion for last, as your overall strategy and ideas will refine while building the technical sections. For personnel sections, upload specific resumes and prompt Zarkon to reference that individual's experience against the SOW requirements.
6. **Review, edit, and refine.** Accept or reject redlines: Zarkon displays additions in green and deletions in red, and you must accept or reject changes before submitting another prompt to avoid confusing the editor. If a section is too short, prompt with concrete instructions (e.g., "Add three paragraphs describing the process for Task X") rather than generic commands like "make it longer". Switch to "Read" mode to check layout formatting or view generated tables clearly.
7. **Save and export.** Export your finished document directly to Markdown or Word. Download and store the project's JSON file back in Google Drive if you need to reload or re-edit the project in Zarkon later.

### Key best practices
- **Garbage in, grounding out.** Zarkon requires clear strategy and source files. It synthesizes provided materials rather than inventing novel strategies on its own.
- **Transcribe technical inputs.** If technical details are complex, conduct a quick 15-minute call with technical experts (e.g., Justin, Bryan), transcribe the meeting, and upload the transcript directly into Zarkon as a reference.`,
  },
];
