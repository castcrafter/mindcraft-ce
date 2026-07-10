import { connect } from '@lancedb/lancedb';
import { 
    Schema, 
    Field, 
    Float32, 
    FixedSizeList, 
    List,
    Utf8, 
} from "apache-arrow";

const VECTOR_DIMENSION = 1024; // Standard for 'nomic-embed-text'
const minecraft_wiki_schema = new Schema([
        // --- The Core ---
        new Field("vector", new FixedSizeList(
            VECTOR_DIMENSION, 
            new Field("item", new Float32(), true)
        )),
        new Field("content", new Utf8()), // The actual text chunk

        // --- Metadata from your JSON ---
        new Field("title", new Utf8()), // e.g., "Tutorial:Nether survival"
        new Field("url", new Utf8()),   // e.g., "https://minecraft.wiki/..."
        
        // --- Metadata from the Markdown Splitter ---
        // The splitter extracts headers. We store them so the bot knows context.
        // e.g. section = "Preparation", subsection = "Tools and weapons"
        new Field("section", new Utf8(), true),    // 'true' means nullable (optional)
        new Field("subsection", new Utf8(), true), 

        // --- Tags ---
        new Field("type", new Utf8()),  // e.g., "wiki", "recipe", "chat_log"
    ]);


export class RAGManager {
    constructor(agent) {
        this.agent = agent;
        this.global_client = null;
        this.minecraft_wiki_table = null;
        this.ready = this._initialize();
    }

    async _initialize() {
        try {
            this.global_client = await connect('./database');
            this.minecraft_wiki_table = await this.global_client.createEmptyTable(
                'minecraft_wiki', minecraft_wiki_schema, { existOk: true, mode: 'create' }
            );
        } catch (error) {
            console.warn(`RAG initialization failed; persistent JSON memory remains available: ${error.message}`);
        }
    }


    async getMinecraftContext(query, topK=1) {
        await this.ready;
        if (!this.minecraft_wiki_table)
            return '';
        if (typeof this.minecraft_wiki_table.countRows === 'function') {
            const rows = await this.minecraft_wiki_table.countRows();
            if (rows === 0)
                return '';
        }
        let vector = await this.agent.prompter.embedding_model.embed(query);
        const results = await this.minecraft_wiki_table.search(vector).limit(topK).toArray();

        const filteredResults = results.map(result => {
            const { vector, ...rest } = result;
            return rest;
        });

        let context = '';

        if (results && results.length > 0) {
            for (let i = 0; i < results.length; i++) {
                context += results[i].content + '\n';
            }
        }
        return context;
    }

    async getSkillsContext(query, topK=5) {
        console.warn('to be implemented: getSkillsContext');
        return '';
    }
    
    async getMemoryContext(query, topK=5) {
        return this.agent.stateStore?.searchMemory(query, topK) || '';
    }

    async getRAGContext(query, topK=5) {
        const wikiContext = await this.getMinecraftContext(query, topK);
        const skillsContext = await this.getSkillsContext(query, topK);
        const memoryContext = await this.getMemoryContext(query, topK);

        let combinedContext = 'Minecraft Information:\n' + wikiContext + '\n';
        combinedContext += 'Agent Skills:\n' + skillsContext + '\n';
        combinedContext += 'Agent Memory:\n' + memoryContext + '\n';

        return combinedContext;
    }


    async addToMemory(id, content, metadata={}) {
        this.agent.stateStore?.remember('memory', content, { id, ...metadata });
    }
}
