public class BupaGearsetPOC {
    
    public static List<Account> getAccounts(){
        return [SELECT Id FROM Account LIMIT 20];
    }
    
     public static List<Contact> getContacts(){
        return [SELECT Id FROM Contact LIMIT 10];
    }

}