// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityTypes, CardFactory } = require('botbuilder');
const { DialogTurnStatus, DialogSet } = require('botbuilder-dialogs');
const { LuisRecognizer } = require('botbuilder-ai');

const MainDialog = require('./dialogs/mainDialog');
const welcomeCard = require('./dialogs/welcome');

const { entityProperty, onTurnProperty } = require('./dialogs/shared/stateProperties');

// LUIS service type entry in the .bot file for dispatch.
const LUIS_CONFIGURATION = 'cafeDispatchModel';

const LUIS_ENTITIES = require('./dialogs/shared/luisEntities');

// State properties
const ON_TURN_PROPERTY = 'onTurnProperty';
const DIALOG_STATE_PROPERTY = 'dialogState';

class Bot {
    /**
     * Bot constructor.
     * 
     * @param {Object} conversationState conversation state object
     * @param {Object} userState user state object
     * @param {Object} botConfig bot configuration
     * 
     */
    constructor (conversationState, userState, botConfig) {
        if(!conversationState) throw ('Missing parameter. conversationState is required');
        if(!userState) throw ('Missing parameter. userState is required');
        if(!botConfig) throw ('Missing parameter. botConfig is required');

        // Create state property accessors.
        this.onTurnPropertyAccessor = conversationState.createProperty(ON_TURN_PROPERTY);
        this.dialogPropertyAccessor = conversationState.createProperty(DIALOG_STATE_PROPERTY);
        
        // add recogizers
        const luisConfig = botConfig.findServiceByNameOrId(LUIS_CONFIGURATION);
        if(!luisConfig || !luisConfig.appId) throw (`Cafe Dispatch LUIS model not found in .bot file. Please ensure you have all required LUIS models created and available in the .bot file. See readme.md for additional information\n`);
        this.luisRecognizer = new LuisRecognizer({
            applicationId: luisConfig.appId,
            azureRegion: luisConfig.region,
            // CAUTION: Its better to assign and use a subscription key instead of authoring key here.
            endpointKey: luisConfig.authoringKey
        });

        // add main dialog
        this.dialogs = new DialogSet(this.dialogPropertyAccessor);
        this.dialogs.add(new MainDialog(botConfig, this.onTurnPropertyAccessor, conversationState, userState));
    }
    /**
     * On turn dispatcher. Responsible for processing turn input, gather relevant properties,
     * and continues or begins main dialog.
     * 
     * @param {Object} context conversation context object
     * 
     */
    async onTurn (context) {
        // See https://aka.ms/about-bot-activity-message to learn more about message and other activity types.
        switch (context.activity.type) {
            case ActivityTypes.Message: {
                // Process on turn input (card or NLP) and gather new properties
                let onTurnProperties = await this.getNewOnTurnProperties(context);
                if(onTurnProperties === undefined) break;
                // Update state with gathered properties (dialog/ intent/ entities)
                this.onTurnPropertyAccessor.set(context, onTurnProperties);
                // Do we have any oustanding dialogs? if so, continue them and get results
                // No active dialog? start a new main dialog
                await this.continueOrBeginMainDialog(context);
                break;
            }
            case ActivityTypes.ConversationUpdate: {
                // Send a welcome card to any user that joins the conversation.
                if(context.activity.membersAdded[0].name !== 'Bot') await this.welcomeUser(context);
                break;
            }
            default: {
                // Handle other acivity types as needed.
                break;            
            }
        }
    }
    /**
     * Async method to continue or begin main dialog
     * 
     * @param {Object} context conversation context object
     * 
     */
    async continueOrBeginMainDialog(context) {
        // Create dialog context.
        let dc = await this.dialogs.createContext(context);
        // Continue outstanding dialogs. 
        let result = await dc.continue();
        // If no oustanding dialogs, begin main dialog
        if(result.status === DialogTurnStatus.empty) {
            await dc.begin(MainDialog.Name);
        }
    }
    /**
     * Async helper method to get on turn properties from cards or NLU using https://LUIS.ai
     * 
     * @param {Object} context conversation context object
     * 
     */
    async getNewOnTurnProperties (context) {
        // Handle card input (if any), update state and return.
        if(context.activity.value !== undefined) return await this.handleCardInput(context.activity.value);
        
        // Acknowledge attachments from user. 
        if(context.activity.attachments && context.activity.attachments.length !== 0) {
            await context.sendActivity(`Thanks for sending me that attachment. I'm still learning to process attachments.`);
            return undefined;
        }

        // Nothing to do for this turn if there is no text specified.
        if(context.activity.text === undefined || context.activity.text.trim() === '') return;

        // make call to LUIS recognizer to get intent + entities
        const LUISResults = await this.luisRecognizer.recognize(context);

        let onTurnProperties = new onTurnProperty();
        onTurnProperties.intent = LuisRecognizer.topIntent(LUISResults);
        // Gather entity values if available. Uses a const list of LUIS entity names. 
        LUIS_ENTITIES.forEach(luisEntity => {
            if(luisEntity in LUISResults.entities) onTurnProperties.entities.push(new entityProperty(luisEntity, LUISResults.entities[luisEntity]))
        });
        return onTurnProperties;
    }
    /**
     * Async helper method to welcome the user.
     * 
     * @param {Object} context conversation context object
     * 
     */
    async welcomeUser (context) {
        // Welcome user.
        await context.sendActivity(`Hello, I am the Contoso Cafe Bot!`);
        await context.sendActivity(`I can help book a table, find cafe locations and more..`);
        // Welcome card with suggested actions.
        await context.sendActivity({ attachments: [CardFactory.adaptiveCard(welcomeCard)]});
    }
    /**
     * Async helper method to process card input and gather turn properties
     * 
     * @param {Object} context conversation context object
     * 
     */
    async handleCardInput (cardValue) {
        // All cards used by this bot are adaptive cards with the card's 'data' property set to useful information.
        let onTurnProperties = new onTurnProperty();
        for(var key in cardValue) {
            if(!cardValue.hasOwnProperty(key)) continue;
            if(key.toLowerCase().trim() === 'intent') {
                onTurnProperties.intent = cardValue[key];
            } else {
                onTurnProperties.entities.push(new entityProperty(key, cardValue[key]));
            }
        }
        return onTurnProperties;
    }
}

module.exports = Bot;