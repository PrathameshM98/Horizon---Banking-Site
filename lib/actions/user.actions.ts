'use server';

import { ID } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";

import { plaidClient } from "../plaid";
import { CountryCode, ProcessorTokenCreateRequest, ProcessorTokenCreateRequestProcessorEnum, Products } from "plaid";
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";
import { error } from "console";

const {
    APPWRITE_DATABASE_ID: DATABASE_ID,
    APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
    APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env

export const signIn = async ({email, password}: signInProps) => {
    try {
        //Mutation/ database/ Make fetch
        const { account } = await createAdminClient();
        const response = await account.
        createEmailPasswordSession(email, password);
    
        return parseStringify(response);
    } catch (error) {
        console.log('Error', error);
    }
}

export const signUp = async ({password, ...userData }: SignUpParams) => {
    const {email, firstName, lastName} = userData;

    let newUserAccount;
    try {
        const { account, database } = await createAdminClient();

        newUserAccount = await account.create(
            ID.unique(), 
            email, 
            password, 
            `${firstName} ${lastName}`
        );

        if(!newUserAccount) throw new Error('Error creating user')

        const dwollaCustomerUrl = await createDwollaCustomer(
            {
                ...userData,
            type: 'personal'
        })
        if(!dwollaCustomerUrl) throw new Error('Error creating dwolla customer')

        const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl)

        const newUser = await database.createDocument(
            DATABASE_ID!,
            USER_COLLECTION_ID!,
            ID.unique(),
            {
                ...userData,
                userId: newUserAccount.$id,
                dwollaCustomerId,
                dwollaCustomerUrl
            }
        )

        const session = await account.createEmailPasswordSession(email, password);
      
        cookies().set("appwrite-session", session.secret, {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
          secure: true,
        });

        return parseStringify(newUser);
    } catch (error) {
        console.log('Error', error);
    }
}

// ... your initilization functions

export async function getLoggedInUser() {
    try {
      const { account } = await createSessionClient();
      const user = await account.get();
      return parseStringify(user);
    } catch (error) {
      return null;
    }
  }

export const logoutAccount = async () => {
    try {
        const {account} = await createSessionClient();
        cookies().delete('appwrite-session');

        await account.deleteSession('current');
    } catch (error) {
        return null;
    }
}
  



export const createLinkToken = async (user: User) => {
    try {
        const tokenParams = {
            user: {
                client_user_id: user.$id
            },
            client_name : '${user.firstName} ${user,lastName}',
            products: ['auth'] as Products[],
            language: 'en',
            country_codes: ['US'] as CountryCode[],
        }

        const response = await plaidClient.linkTokenCreate(tokenParams);
        
        return parseStringify({linkToken: response.data.link_token})
    } catch (error) {
        console.log(error);
    }
}


export const createBankAccount = async ({
    userId,
    bankId,
    accountId,
    accessToken,
    fundingSourceUrl,
    shareableId
}: createBankAccountProps) => {
    try {
        const { database } = await createAdminClient();

        const bankAccount = await database.createDocument(
            DATABASE_ID!,
            BANK_COLLECTION_ID!,
            ID.unique(),
            {
                userId,
                bankId,
                accountId,
                accessToken,
                fundingSourceUrl,
                shareableId
            }



        )
        return parseStringify(bankAccount);
    } catch (error) {
        
    }
}





export const exchangePublicToken = async ({
    publicToken,
    user,
}: exchangePublicTokenProps) => {
    try {
        const response = await plaidClient.itemPublicTokenExchange({
            public_token: publicToken,
        });

        const accessToken = response.data.access_token;
        const itemId = response.data.item_id;

        const accountsResponse = await plaidClient.accountsGet({
            access_token: accessToken,
        });

        const accountData = accountsResponse.data.accounts[0];

        const request: ProcessorTokenCreateRequest = {
            access_token: accessToken,
            account_id: accountData.account_id,
            processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
        };

        const processorTokenResponse = 
        await plaidClient.processorTokenCreate(request);
        const processorToken = processorTokenResponse.data.processor_token;


        const fundingSourceUrl = await addFundingSource({
            dwollaCustomerId: user.dwollaCustomerId,
            processorToken,
            bankName: accountData.name,
        });

        if(!fundingSourceUrl) throw Error;

        await createBankAccount({
            userId: user.$id,
            bankId: itemId,
            accountId: accountData.account_id,
            accessToken,
            fundingSourceUrl,
            shareableId: encryptId(accountData.account_id),
        });

        revalidatePath("/")

        return parseStringify({
            publicTokenExchange: "Complete",
        });



    } catch (error) {
        console.error("An error occured while creating exchange token:", 
        error);
    }
}